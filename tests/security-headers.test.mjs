/**
 * GUARD TEST — the response-header contract of nginx.conf (issue #3).
 *
 * WHY A TEST AND NOT A REVIEW NOTE. Every header in this file is invisible in
 * unit tests, invisible in `ng build`, and invisible in a browser that happens
 * to work — the failures they prevent (a blank page, a blocked avatar, a video
 * that will not start) only appear in a deployed image. Worse, nginx's
 * `add_header` DOES NOT MERGE: the moment a `location` block declares one
 * header of its own it silently drops every header inherited from `server`
 * scope. So the realistic way this contract rots is not "somebody deletes the
 * CSP", it is "somebody adds a location and forgets to re-declare the set".
 * This test therefore walks EVERY block that nginx will serve from and asserts
 * the full set in each one, with the exact value.
 *
 * It parses nginx.conf itself (comments stripped first, so a commented-out
 * directive can never satisfy a guard) rather than probing a running server,
 * because the container this file configures cannot be built in the unit-test
 * lane. The complementary live proof — build the app, serve it with these exact
 * headers, load it in headless Chromium and read the console — is recorded in
 * the PR for issue #3.
 *
 * Run: `npm run test:headers`  (node --test, no dependencies).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NGINX_CONF = join(import.meta.dirname, '..', 'nginx.conf');
const RAW = readFileSync(NGINX_CONF, 'utf8');

// ---------------------------------------------------------------------------
// Minimal nginx reader. Deliberately small and quote-aware rather than a real
// parser: it only has to answer "which add_header directives does THIS block
// declare itself", which is exactly the question `add_header`'s non-merging
// behaviour makes load-bearing.
// ---------------------------------------------------------------------------

/** Strip `#` comments, but never a `#` inside a quoted string. */
function stripComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
  }
  return out;
}

const CONF = stripComments(RAW);

/** Body of the first block whose header line matches `re`, plus its span. */
function blockBody(src, re, from = 0) {
  const m = re.exec(src.slice(from));
  if (!m) return null;
    const openIdx = src.indexOf('{', from + m.index);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(openIdx + 1, i), start: from + m.index, end: i };
    }
  }
  return null;
}

/**
 * Every nested block inside `body` that nginx can serve a DIFFERENT header set
 * from, recursively: `location <match> { ... }` AND `if (<cond>) { ... }`.
 *
 * A nested location is not a cosmetic case: nginx applies `add_header`'s
 * non-merging rule at EVERY configuration level, so a
 * `location ~* \.(?:js|mjs|css)$ { ... }` added inside `location /` to set a
 * cache header — the single most common edit an SPA nginx.conf receives —
 * silently drops the entire inherited security set for every JS/CSS bundle this
 * remote serves. Walking only the top level would bless exactly that.
 *
 * `if` blocks are walked for the SAME reason, and this was a real hole: an
 * earlier revision of this file walked `location` only, so
 *   location = /healthz { if ($arg_dl) { add_header Content-Type application/octet-stream; } }
 * passed the whole suite and passed `nginx -t`. An `if` block is its own
 * configuration level, so an `add_header` inside one REPLACES the inherited set
 * for every request that matches the condition — which makes it an evasion of
 * the entire contract, not just of the Content-Type guard. MEASURED: with
 * `if ($arg_dl) { add_header X-Frame-Options "SAMEORIGIN" always; }` inside
 * `location = /healthz`, `GET /healthz?dl=1` answers with X-Frame-Options
 * SAMEORIGIN and NONE of the other seven security headers, while plain
 * `GET /healthz` keeps all eight.
 */
function nestedBlocks(body) {
  const blocks = [];
  // Two block openers, one scan, so ordering and nesting stay consistent:
  //   group 1 = a location's match spec, group 2 = an if's parenthesised test.
  const re = /(?:\blocation\s+([^{]+?)|\bif\s*(\([^)]*\)))\s*\{/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const kind = m[1] !== undefined ? 'location' : 'if';
    const label = kind === 'location' ? `location ${m[1].trim()}` : `if ${m[2]}`;
    let depth = 0;
    for (let i = openIdx; i < body.length; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') {
        depth--;
        if (depth === 0) {
          const inner = body.slice(openIdx + 1, i);
          blocks.push({ kind, match: label, body: inner });
          // Recurse: a nested block ALSO drops every inherited add_header.
          for (const n of nestedBlocks(inner)) {
            blocks.push({ kind: n.kind, match: `${label} > ${n.match}`, body: n.body });
          }
          re.lastIndex = i;
          break;
        }
      }
    }
  }
  return blocks;
}

/**
 * `body` with every nested block removed, i.e. exactly the directives THIS
 * configuration level declares itself. Both the `add_header` scan and the
 * `sub_filter` scan need it, and for the same reason: nginx resolves both at
 * one level, so a directive that lives in a child block must never be read as
 * if the parent declared it.
 */
function ownBody(body) {
  let own = body;
  // Remove nested blocks so a server-scope scan does not inherit a location's.
  for (;;) {
    const openIdx = own.indexOf('{');
    if (openIdx === -1) break;
    let depth = 0, closeIdx = -1;
    for (let i = openIdx; i < own.length; i++) {
      if (own[i] === '{') depth++;
      else if (own[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
    }
    if (closeIdx === -1) break;
    // Drop back to the start of the directive that opened the block.
    const lineStart = own.lastIndexOf('\n', openIdx) + 1;
    own = own.slice(0, lineStart) + own.slice(closeIdx + 1);
  }
  return own;
}

/** add_header directives declared directly in `body` (nested blocks removed). */
function addHeaders(body) {
  const own = ownBody(body);
  const headers = [];
  const re = /add_header\s+(\S+)\s+("(?:[^"]*)"|\S+)\s*(always)?\s*;/g;
  let m;
  while ((m = re.exec(own)) !== null) {
    headers.push({
      name: m[1],
      value: m[2].startsWith('"') ? m[2].slice(1, -1) : m[2],
      always: m[3] === 'always',
    });
  }
  return headers;
}

// EVERY server block, not just the first: an appended `server { listen 8081; }`
// serving responses with no security headers at all must not pass this suite.
const SERVERS = [];
for (let from = 0; ; ) {
  const s = blockBody(CONF, /server\s*\{/, from);
  if (!s) break;
  SERVERS.push(s);
  from = s.end + 1;
}
assert.ok(SERVERS.length >= 1, 'nginx.conf must contain a server block');

/**
 * Every block nginx can serve a response from: server scope + each nested
 * `location` / `if`.
 *
 * `inherits` marks a block that declares NO add_header of its own. nginx then
 * hands it the enclosing level's set unchanged, so requiring the full set there
 * would be a false failure. It is set only for `if` blocks: a `location` is
 * still required to re-declare the set unconditionally, because this file's
 * documented convention is that every location repeats it and because a
 * location that inherits today is one `add_header` away from silently dropping
 * all eight tomorrow. An `if` with no add_header (`if ($request_method = POST)
 * { return 405; }`) is a legitimate shape with nothing to re-declare.
 */
const BLOCKS = SERVERS.flatMap((srv, n) => {
  const tag = SERVERS.length > 1 ? ` #${n + 1}` : '';
  return [
    { label: `server${tag} scope`, headers: addHeaders(srv.body), body: srv.body, own: ownBody(srv.body) },
    ...nestedBlocks(srv.body).map((l) => {
      const headers = addHeaders(l.body);
      return {
        label: `server${tag} ${l.match}`,
        headers,
        body: l.body,
        own: ownBody(l.body),
        // `kind` is the INNERMOST block's kind, so a nested
        // `location / > if (...)` is judged as the `if` it is.
        inherits: l.kind === 'if' && headers.length === 0,
      };
    }),
  ];
});

/**
 * Response header field names that may legitimately appear more than once. Kept
 * deliberately tiny: everything else is single-valued here, and a second
 * `add_header` for a single-valued field is a defect, not a style.
 */
const REPEATABLE = new Set(['set-cookie', 'link']);

/** Every add_header this block declares for `name`, in file order. */
const all = (block, name) =>
  block.headers.filter((h) => h.name.toLowerCase() === name.toLowerCase());

/**
 * THE one add_header this block declares for `name` — and a hard failure if it
 * declares two.
 *
 * WHY THIS FAILS INSTEAD OF RETURNING THE FIRST MATCH. `add_header` APPENDS. A
 * second directive for the same field name does not replace the first, it puts
 * a SECOND field on the wire, and the browser then applies its own per-header
 * combination rule to the pair — which for the two headers this file cares most
 * about is not "the first one wins". Measured on
 * nginxinc/nginx-unprivileged:1.27-alpine serving this exact file, read in
 * headless Chromium 149:
 *   - two `Cross-Origin-Embedder-Policy` fields (the shipped `credentialless`
 *     plus a `require-corp`) -> both fields ship and `crossOriginIsolated`
 *     flips true -> FALSE. Cross-origin isolation silently lost.
 *   - two `Content-Security-Policy` fields (the shipped policy plus a narrower
 *     `default-src 'self'; script-src 'self'`) -> CSP is enforced
 *     CONJUNCTIVELY, so the NARROWER one decides: blank page at HTTP 200, with
 *     "Executing inline script violates the following Content Security Policy
 *     directive 'script-src 'self''" in the console. That is the exact
 *     blank-page failure this whole file exists to prevent.
 * This lookup was `headers.find(...)` — first match only — until this commit,
 * so BOTH of those mutations passed the entire suite green.
 */
const get = (block, name) => {
  const hits = all(block, name);
  if (hits.length > 1 && !REPEATABLE.has(name.toLowerCase())) {
    assert.fail(
      `${block.label} declares ${name} ${hits.length} times ` +
        `(${hits.map((h) => JSON.stringify(h.value)).join(', ')}). add_header APPENDS, so both ` +
        `fields ship and the browser combines them — a second CSP is enforced conjunctively ` +
        `(the narrower one wins, i.e. a blank page) and a second COEP drops cross-origin ` +
        `isolation. Declare exactly one.`,
    );
  }
  return hits[0];
};

/**
 * Can this block serve NOTHING but one fixed, non-HTML resource?
 *
 * Such a block is exempt from the CSP/CORS contract below: a Content-Security-
 * Policy on a stylesheet or a three-byte text/plain probe governs no document
 * and grants no script, and the CORS grant exists for the federation bundles.
 * The test is deliberately conjunctive — it pins the media type with
 * `default_type` to something other than text/html AND answers from a `return`
 * or a single-file `alias` AND cannot fall through to the SPA via `try_files` —
 * so "add a `default_type text/plain;`" is not a way to opt a block that really
 * does serve the app out of carrying a policy.
 */
function servesOnlyFixedNonHtml(body) {
  const dt = /(?:^|[\s;{])default_type\s+([^\s;]+)\s*;/.exec(body);
  if (!dt || dt[1] === 'text/html') return false;
  if (/\btry_files\b/.test(body)) return false;
  return /\breturn\s+\d/.test(body) || /\balias\s+\S+\.[A-Za-z0-9]+\s*;/.test(body);
}

/**
 * The blocks that must DECLARE the full set. Everything except an `if` that
 * declares no add_header at all and therefore inherits the enclosing level's
 * headers verbatim. The Content-Type guard below deliberately runs over ALL of
 * BLOCKS instead: it only fires when a block actually sets the header, so an
 * inheriting block is vacuously fine there and an `if` that sets Content-Type
 * is still caught.
 */
const ENFORCED = BLOCKS.filter((b) => !b.inherits);

/**
 * The blocks that must also carry the Content-Security-Policy and the
 * federation CORS grant: everything that can serve an app DOCUMENT or a
 * federation ASSET, which is every enforced block except the fixed non-HTML
 * ones above.
 *
 * WHY THIS IS NOT "the block labelled `location /`". Both headers used to be
 * asserted with `BLOCKS.find((b) => b.label.endsWith('location /'))`, i.e. on
 * one named block, so a NESTED location that re-declared the eight baseline
 * headers and dropped these two walked through the suite green. Measured, both
 * of them, end to end:
 *   - `location = /index.html { <the eight> }` inside `location /`: nginx's
 *     `index index.html` internal redirect makes that exact-match block serve
 *     `GET /`, so the app document ships with ZERO Content-Security-Policy.
 *     Behind a proxy mimicking hugmesh-gateway's SecurityConfig (which adds
 *     `default-src 'self'; script-src 'self'` only when the upstream sent none)
 *     the page is BLANK at HTTP 200 — no router-outlet, console reports
 *     "Executing inline script violates … 'script-src 'self''". The shipped
 *     config through the identical proxy bootstraps clean.
 *   - `location ~* \.(?:js|mjs)$ { <the eight> + the CSP }` inside `location /`:
 *     suite green, and every federation bundle loses the
 *     Access-Control-Allow-Origin the host shell needs to fetch it cross-origin.
 */
const APP_CONTENT = ENFORCED.filter((b) => !servesOnlyFixedNonHtml(b.body));

// ---------------------------------------------------------------------------
// THE CONTRACT. Each value carries the reason it is that value and not the
// stricter-looking one; the "why not stricter" cases are separately asserted as
// mutation guards further down.
// ---------------------------------------------------------------------------
const REQUIRED = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // In REQUIRED, not asserted only on `location /`: the two theme-CSS blocks
  // shipped without HSTS until this was pinned, while the README described the
  // baseline set as re-declared in EVERY location.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // Issue #3 — the three that were outstanding.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Permissions-Policy':
    'accelerometer=(), autoplay=(self), browsing-topics=(), camera=(), display-capture=(), ' +
    'encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), hid=(), ' +
    'idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), ' +
    'picture-in-picture=(self), publickey-credentials-get=(), screen-wake-lock=(), serial=(), ' +
    'usb=(), xr-spatial-tracking=()',
};

/**
 * The CSP, verbatim. Pinned rather than pattern-matched — see the widening guard
 * in the nonce-contract test for why presence checks are not enough.
 */
const CSP_EXACT =
  "default-src 'self'; script-src 'self' 'nonce-$cspnonce' blob:; style-src 'self' " +
  "'unsafe-inline' blob:; img-src 'self' data: https:; font-src 'self' data:; " +
  "media-src 'self'; connect-src 'self' blob: https:; base-uri 'self'; object-src 'none'; " +
  "frame-ancestors 'none'";

test('every server/location block declares the full security-header set', () => {
  assert.ok(ENFORCED.length >= 5, `expected server scope + >=4 locations, saw ${ENFORCED.length}`);
  for (const block of ENFORCED) {
    for (const [name, value] of Object.entries(REQUIRED)) {
      const h = get(block, name);
      assert.ok(
        h,
        `${block.label} does not emit ${name}. nginx add_header DOES NOT MERGE — a block ` +
          `with any add_header of its own drops EVERY server-scope header, so this response ` +
          `would ship with no ${name} at all. Re-declare the whole set in this block.`,
      );
      assert.equal(
        h.value,
        value,
        `${block.label} emits ${name}: "${h.value}" but the contract is "${value}".`,
      );
      assert.ok(
        h.always,
        `${block.label} emits ${name} without \`always\`, so error responses (4xx/5xx) ship ` +
          `without it.`,
      );
    }
  }
});

test('the CSP nonce contract is intact (a blank page is the failure mode)', () => {
  const nonceMap = blockBody(CONF, /map\s+\$request_id\s+\$cspnonce\s*\{/);
  assert.ok(
    nonceMap,
    'the `map $request_id $cspnonce` block is gone: $cspnonce would expand to the empty string, ' +
      'the CSP would carry `nonce-` and NOTHING would execute — a blank page at HTTP 200.',
  );
  // The map's BODY, not just its existence. Asserting only that the block is
  // present cannot see the two one-token edits that break it:
  //   default "";        -> every CSP carries `nonce-`, no <script> matches,
  //                         Angular never bootstraps, /tube/ is blank at HTTP 200.
  //   default "abc123";  -> ONE nonce reused across every response, which is
  //                         'unsafe-inline' the moment anyone reads one body.
  assert.match(
    nonceMap.body,
    /default\s+\$request_id\s*;/,
    'the $cspnonce map no longer resolves to $request_id. An EMPTY default makes every CSP ' +
      'carry `nonce-`, nothing executes and /tube/ is a blank page at HTTP 200; a CONSTANT ' +
      "default is one nonce reused across every response, i.e. 'unsafe-inline' with extra steps.",
  );

  const app = BLOCKS.find((b) => b.label.endsWith('location /'));
  assert.ok(app, 'the SPA/federation location / is gone');

  const csp = get(app, 'Content-Security-Policy');
  assert.ok(csp, 'location / emits no Content-Security-Policy. The gateway would then apply its ' +
    'blanket fallback (`script-src \'self\'`), which blocks the inline esms-options script and ' +
    'blanks /tube/.');

  assert.match(csp.value, /script-src[^;]*'nonce-\$cspnonce'/,
    'script-src lost the per-response nonce.');
  assert.match(csp.value, /script-src[^;]*\bblob:/,
    'script-src lost blob: — es-module-shims executes rewritten modules from blob: URLs.');
  assert.match(csp.value, /style-src[^;]*\bblob:/,
    'style-src lost blob: — es-module-shims also fetches a stylesheet from a blob: URL.');
  assert.match(csp.value, /connect-src[^;]*\bblob:/,
    'connect-src lost blob: — es-module-shims fetches its rewritten modules through it.');
  assert.doesNotMatch(csp.value, /script-src[^;]*'unsafe-inline'/,
    "script-src must never gain 'unsafe-inline' — the nonce exists precisely so it does not.");
  assert.doesNotMatch(csp.value, /'unsafe-eval'/,
    "'unsafe-eval' must not appear: this UI ships no wasm and no eval-based loader.");
  assert.match(csp.value, /media-src\s+'self'/,
    "media-src must stay 'self': the player's signed URL is the same-origin " +
      '/tube/content/<path>?sig=… path, and nothing here uses MSE/blob: media.');
  assert.match(csp.value, /frame-ancestors\s+'none'/, 'frame-ancestors must stay none.');
  assert.match(csp.value, /object-src\s+'none'/, 'object-src must stay none.');
  assert.match(csp.value, /base-uri\s+'self'/, 'base-uri must stay self.');

  // WIDENING GUARD. Every assertion above is a PRESENCE check — none of them can
  // see a directive that GREW a source. Measured: with only those checks,
  // `img-src *`, `default-src *`, `connect-src *`, `media-src 'self' blob:` and
  // `script-src 'self' 'nonce-$cspnonce' blob: https:` ALL pass. That last one is
  // the dangerous one: in CSP3 a host-source alongside a nonce makes the nonce
  // DECORATIVE, so any https origin could serve script into /tube/ — through a
  // guard whose own failure text says script-src is pinned. So pin it verbatim.
  // Change this literal deliberately, in the same commit as the nginx.conf edit.
  assert.equal(
    csp.value,
    CSP_EXACT,
    'the Content-Security-Policy changed. Every source list here is load-bearing and the ' +
      'failure mode of a WIDENING is silent — the app keeps working, the protection is gone. ' +
      'If the change is deliberate, update CSP_EXACT in the same commit and say in the PR ' +
      'which directive grew and why.',
  );
  assert.ok(
    csp.always,
    'the CSP add_header lost `always`: 4xx/5xx responses would ship with no CSP at all, and ' +
      'the SPA fallback serves index.html through error paths.',
  );

  // The nonce is only real if it is actually injected into index.html.
  assert.match(app.body, /sub_filter_once\s+off\s*;/,
    'sub_filter_once off is gone: only the FIRST <script> would get a nonce and the rest of the ' +
      'federation bootstrap would be blocked.');
  assert.match(app.body, /sub_filter_types\s+text\/html\s*;/,
    'sub_filter_types text/html is gone: the JS bundles would be rewritten too.');
  assert.match(app.body, /sub_filter\s+'<script'\s+'<script nonce="\$cspnonce"'\s*;/,
    'the nonce injection sub_filter is gone: the CSP would demand a nonce no tag carries.');
  assert.doesNotMatch(CONF, /gzip_static\s+(on|always)\s*;/,
    'gzip_static would serve a precompressed index.html that sub_filter CANNOT rewrite — the ' +
      'nonce silently disappears while the CSP still demands it.');
});

test('the CSP and the CORS grant are on EVERY block that can serve app content', () => {
  // The companion to the nonce-contract test above, which checks the POLICY on
  // one named block. This one checks the SCOPE: that no block able to hand a
  // browser an app document, or the host shell a federation bundle, can exist
  // without them. Both are the "silently green" gaps measured in the comment on
  // APP_CONTENT.
  assert.ok(
    APP_CONTENT.length >= 2,
    `expected at least server scope + location /, saw ${APP_CONTENT.length}: ` +
      APP_CONTENT.map((b) => b.label).join(', '),
  );
  for (const block of APP_CONTENT) {
    const csp = get(block, 'Content-Security-Policy');
    assert.ok(
      csp,
      `${block.label} can serve an app document or a federation bundle and emits no ` +
        `Content-Security-Policy. That response does not go out unprotected — it inherits ` +
        `hugmesh-gateway's blanket fallback (\`script-src 'self'\`), which blocks the inline ` +
        `esms-options script, stops Angular bootstrapping and serves a BLANK PAGE at HTTP 200. ` +
        `If this block genuinely serves one fixed non-HTML file, give it a \`default_type\` and ` +
        `a \`return\`/single-file \`alias\` (see servesOnlyFixedNonHtml) rather than dropping the ` +
        `header.`,
    );
    assert.equal(
      csp.value,
      CSP_EXACT,
      `${block.label} emits a Content-Security-Policy that differs from the one pinned in ` +
        `CSP_EXACT. Two blocks serving the same app under different policies is how a ` +
        `tightening lands on one path and a widening on another, both silently.`,
    );
    assert.ok(
      csp.always,
      `${block.label} emits the CSP without \`always\`, so its 4xx/5xx responses ship without ` +
        `it — and the SPA fallback serves index.html through error paths.`,
    );

    const acao = get(block, 'Access-Control-Allow-Origin');
    assert.equal(
      acao?.value,
      '*',
      `${block.label} does not grant Access-Control-Allow-Origin: *. This container exists to ` +
        `be read cross-origin: the hugmesh.net host shell fetches /remoteEntry.json and the ` +
        `exposed chunks from another origin, and the dev federation.manifest.json points a ` +
        `:4200 host at this remote. Without the grant the remote loads standalone and fails ` +
        `only under the shell.`,
    );
    assert.ok(acao.always, `${block.label} emits Access-Control-Allow-Origin without \`always\`.`);
  }
});

test('no block declares the same response header twice (add_header APPENDS)', () => {
  // `get()` already refuses to answer for a duplicated header, which protects
  // every assertion in this file. This test is the general case: it also catches
  // a duplicate of a header NOTHING else here looks at, and it names all of them
  // in one failure instead of whichever the first assertion happened to hit.
  for (const block of BLOCKS) {
    const seen = new Map();
    for (const h of block.headers) {
      const key = h.name.toLowerCase();
      if (REPEATABLE.has(key)) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
    assert.deepEqual(
      dupes,
      [],
      `${block.label} declares the same header more than once: ${dupes.join(', ')}. add_header ` +
        `does not replace, it APPENDS — both fields go on the wire and the browser combines ` +
        `them (two CSPs are enforced conjunctively, i.e. the narrower one blanks the page; two ` +
        `COEPs drop cross-origin isolation). Edit the existing directive instead of adding one.`,
    );
  }
});

test('the nonce injection survives wherever sub_filter can be overridden', () => {
  // sub_filter, UNLIKE add_header, does inherit — but only while the inner level
  // declares none of its own. One `sub_filter` in a nested block therefore drops
  // every inherited one, exactly like add_header, and the CSP that block still
  // emits then demands a nonce no <script> tag carries: a blank page at HTTP 200.
  const INJECT = /sub_filter\s+'<script'\s+'<script nonce="\$cspnonce"'\s*;/;

  // The injection must exist at server scope, because that is the level every
  // block declaring no sub_filter of its own inherits it from — including the
  // nonce-bearing CSP now declared there.
  for (const srv of SERVERS) {
    assert.match(
      ownBody(srv.body),
      INJECT,
      'server scope declares the nonce-bearing CSP but not the sub_filter that puts that nonce ' +
        'on the <script> tags. Any block inheriting from server scope would then serve a policy ' +
        'nothing satisfies — a blank page at HTTP 200.',
    );
  }

  for (const block of BLOCKS) {
    if (!/\bsub_filter(_once|_types)?\s/.test(block.own)) continue;
    assert.match(
      block.own,
      INJECT,
      `${block.label} declares a sub_filter directive but not the nonce injection. Declaring ` +
        `ANY sub_filter directive at a level discards every sub_filter inherited from the ` +
        `enclosing level, so this block would serve index.html with un-nonced <script> tags ` +
        `under a CSP that requires the nonce — blank page at HTTP 200.`,
    );
    assert.match(
      block.own,
      /sub_filter_once\s+off\s*;/,
      `${block.label} declares the nonce injection without \`sub_filter_once off\`, so only the ` +
        `FIRST <script> would be nonced and the rest of the federation bootstrap stays blocked.`,
    );
    const types = /sub_filter_types\s+([^;]+);/.exec(block.own);
    if (types) {
      assert.equal(
        types[1].trim(),
        'text/html',
        `${block.label}: sub_filter_types must stay exactly text/html. Widen it and nginx ` +
          `rewrites the JS bundles too — they legitimately contain the literal "<script".`,
      );
    }
  }
});

test('nothing in the server block is hidden from this parser', () => {
  // This suite reads nginx.conf as text and does not follow `include`. So an
  // `include /etc/nginx/extra-headers.conf;` inside a location is a blind spot:
  // measured, adding one passes the whole suite, and whatever that file declares
  // — including an add_header that appends a second CSP — is invisible here.
  // There is no include in this file today, so pin that rather than leave the
  // hole open. If one is genuinely needed, teach the parser to follow it in the
  // same commit.
  for (const srv of SERVERS) {
    assert.doesNotMatch(
      srv.body,
      /(?:^|[\s;{])include\s+[^;]+;/,
      'an `include` inside the server block puts directives this suite cannot see into the ' +
        'response path. Every guard here would still pass while the included file appended a ' +
        'second Content-Security-Policy or replaced the header set. Inline the directives, or ' +
        'extend this parser to follow includes in the same commit.',
    );
  }
});

// ---------------------------------------------------------------------------
// MUTATION GUARDS. Each of these is the "obviously stricter" value a future
// reader is most likely to reach for, and each one is measured-broken. They are
// asserted separately from the equality checks above so the failure message
// explains WHY the stricter value is wrong rather than just "expected X got Y".
// ---------------------------------------------------------------------------
test('COEP is not require-corp (it would block the Google channel avatars)', () => {
  for (const block of BLOCKS) {
    const h = get(block, 'Cross-Origin-Embedder-Policy');
    assert.notEqual(
      h?.value,
      'require-corp',
      `${block.label}: require-corp blocks every cross-origin no-cors subresource that does not ` +
        `send CORP. This UI loads channel avatars straight from Google's CDN as plain <img> ` +
        `(tube-my.component.html, [attr.src]="s.thumbnailUrl"), and those hosts promise no CORP: ` +
        `measured in headless Chromium 149 the images fail with ` +
        `net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep. ` +
        `credentialless gives the SAME cross-origin isolation without that breakage.`,
    );
  }
});

test('CORP stays cross-origin (this server is a federation remote)', () => {
  for (const block of ENFORCED) {
    const h = get(block, 'Cross-Origin-Resource-Policy');
    assert.ok(
      h && !['same-origin', 'same-site'].includes(h.value),
      `${block.label}: CORP must not be tightened to ${h?.value}. This container exists to be ` +
        `loaded by ANOTHER document (the hugmesh.net host shell fetches /tube/remoteEntry.json ` +
        `and the exposed chunks; the dev federation.manifest.json points a :4200 host at this ` +
        `remote cross-origin). hugmesh-gateway records the consequence in its own SecurityConfig: ` +
        `COEP require-corp is off at the front door "until the remotes are CORP-tagged" — this ` +
        `header IS that tagging. Measured: a require-corp embedder blocks a remote's no-cors ` +
        `subresources unless the remote answers cross-origin. Tightening buys nothing either: ` +
        `CORP does not govern CORS-mode requests, so remoteEntry.json and the module imports load ` +
        `identically under all three values.`,
    );
  }
});

test('Permissions-Policy keeps the three features the <video> player needs', () => {
  const KEEP = { autoplay: '(self)', fullscreen: '(self)', 'picture-in-picture': '(self)' };
  const DENY = ['camera', 'microphone', 'geolocation', 'display-capture', 'payment', 'usb'];
  for (const block of ENFORCED) {
    const pp = get(block, 'Permissions-Policy');
    assert.ok(pp, `${block.label} emits no Permissions-Policy`);
    const features = Object.fromEntries(
      pp.value.split(',').map((s) => {
        const [k, v] = s.split('=');
        return [k.trim(), v.trim()];
      }),
    );
    for (const [name, want] of Object.entries(KEEP)) {
      assert.equal(
        features[name],
        want,
        `${block.label}: ${name} must be ${want}, not ${features[name]}. An EMPTY allowlist ` +
          `\`${name}=()\` denies every origin INCLUDING self, which breaks the watch player — ` +
          `autoplay=() means the <video autoplay> never starts, and fullscreen=()/` +
          `picture-in-picture=() kill the buttons in the browser's own <video controls> chrome. ` +
          `This is the header equivalent of the matrix-ui camera=() regression.`,
      );
    }
    for (const name of DENY) {
      assert.equal(features[name], '()', `${block.label}: ${name} must be denied outright — Tube ` +
        `has no such surface.`);
    }
  }
});

test('every Permissions-Policy feature name is one Chromium recognises', () => {
  // An unrecognised name makes Chromium log `Error with Permissions-Policy header:
  // Unrecognized feature: 'x'` at console ERROR level on EVERY page load, which
  // turns this header into permanent console noise and hides real errors. This
  // list is the set verified against the Chromium 149 that ships with the
  // repo's Playwright toolchain; extend it only after re-verifying.
  const RECOGNISED = new Set([
    'accelerometer', 'autoplay', 'browsing-topics', 'camera', 'display-capture',
    'encrypted-media', 'fullscreen', 'geolocation', 'gyroscope', 'hid', 'idle-detection',
    'local-fonts', 'magnetometer', 'microphone', 'midi', 'payment', 'picture-in-picture',
    'publickey-credentials-get', 'publickey-credentials-create', 'screen-wake-lock', 'serial',
    'storage-access', 'usb', 'window-management', 'xr-spatial-tracking', 'clipboard-read',
    'clipboard-write', 'compute-pressure', 'attribution-reporting', 'bluetooth',
  ]);
  for (const block of ENFORCED) {
    const pp = get(block, 'Permissions-Policy');
    for (const clause of pp.value.split(',')) {
      const name = clause.split('=')[0].trim();
      assert.ok(
        RECOGNISED.has(name),
        `${block.label}: "${name}" is not in the verified-recognised set. If Chromium does not ` +
          `know it, it logs a console ERROR on every page load. Verify it against the browser ` +
          `first, then add it here.`,
      );
    }
  }
});

test('no block sets Content-Type with add_header (it APPENDS, so the field ships twice)', () => {
  // MEASURED, not theoretical. `location = /healthz` shipped
  // `add_header Content-Type text/plain;` and the live response carried the
  // field TWICE — `application/octet-stream` (nginx's default_type, already set
  // by the time the header filter runs) followed by `text/plain` — because
  // add_header APPENDS and never replaces. The fix is `default_type`, which
  // REPLACES: with add_header, 2 Content-Type headers; with default_type, 1
  // (`text/plain`), body still `ok`, all eight security headers still present.
  // Verified against nginxinc/nginx-unprivileged:1.27-alpine serving this file.
  //
  // CORRECTION. An earlier revision of this comment asserted that the duplicate
  // combined with `X-Content-Type-Options: nosniff` to pin the browser to the
  // FIRST field and turn the three-byte `ok` into a download. THAT WAS WRONG.
  // Four-way measurement, same image, headless Chromium 149 + curl:
  //   pre-fix (2 fields, nosniff ON)   -> document.contentType text/plain, no download
  //   post-fix (default_type)          -> text/plain, no download
  //   pre-fix, nosniff REMOVED         -> IDENTICAL to pre-fix (nosniff is irrelevant)
  //   CONTROL: no type declared at all -> application/octet-stream, and Chromium
  //                                       DOES download it
  // Browsers take the LAST Content-Type (Fetch "extract a MIME type" overwrites
  // per value); curl's %{content_type} agrees. So this guard defends spec
  // hygiene, and the guard BELOW — `/healthz` must still declare default_type —
  // is the one defending the behaviour a user could actually see.
  for (const block of BLOCKS) {
    const ct = get(block, 'Content-Type');
    assert.ok(
      !ct,
      `${block.label} sets Content-Type with add_header ("${ct?.value}"). add_header APPENDS to ` +
        `the Content-Type nginx has already derived from default_type, so the response ships two ` +
        `Content-Type fields. Browsers and curl resolve the LAST one, so this is spec hygiene ` +
        `rather than a user-visible break — but two fields is still wrong, and the block below ` +
        `is what stops the fix being "satisfied" by deleting the type declaration entirely ` +
        `(THAT one really does download). Use \`default_type\` in this block instead — it replaces.`,
    );
  }
});

test('the health endpoint still declares its media type (via default_type)', () => {
  // The companion to the guard above: "no add_header Content-Type" must not be
  // satisfiable by simply DELETING the type declaration, which would leave
  // /healthz answering `application/octet-stream` — the same wrong answer,
  // reached by removing the fix instead of the bug.
  const hz = BLOCKS.find((b) => b.label.endsWith('location = /healthz'));
  assert.ok(hz, 'the /healthz location is gone');
  assert.match(
    hz.body,
    /default_type\s+text\/plain\s*;/,
    'location = /healthz no longer declares `default_type text/plain;`. Without it the ' +
      "endpoint answers nginx's stock application/octet-stream, and Chromium DOWNLOADS an " +
      'octet-stream response instead of displaying it — a download prompt for a three-byte ' +
      'health probe. MEASURED, and measured WITHOUT nosniff too: removing ' +
      '`X-Content-Type-Options: nosniff` from this block changes nothing, the download still ' +
      'happens. It is the octet-stream type alone that does it, not any interaction with ' +
      'nosniff (an earlier revision of this message said otherwise and was wrong).',
  );
});

test('HSTS and the federation CORS grant survive on the blocks that carry them', () => {
  const app = BLOCKS.find((b) => b.label.endsWith('location /'));
  const hsts = get(app, 'Strict-Transport-Security');
  assert.ok(hsts?.value.startsWith('max-age=31536000'), 'location / lost HSTS');
  const acao = get(app, 'Access-Control-Allow-Origin');
  assert.equal(acao?.value, '*',
    'location / lost the CORS grant the host shell needs to fetch remoteEntry.json and the ' +
      'exposed chunks cross-origin in the dev topology.');
});
