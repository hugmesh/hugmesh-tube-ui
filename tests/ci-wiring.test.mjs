/**
 * GUARD TEST — the pen-test wiring in .gitlab-ci.yml (issue #1).
 *
 * WHY A TEST. `pentest:dast` is `allow_failure: true` BY POLICY, so the pipeline view
 * cannot tell "DAST ran and found nothing" from "DAST could not run at all". This repo
 * used to be the second kind: it extended `.pentest-dast-baseline` but vendored no
 * `tests/pentest`, so the job died at the harness lookup having scanned nothing. The fix
 * is to FETCH the harness from hugmesh-generator at CI time (the same ref the `include:`
 * pins, so template and harness stay in lockstep) — and the ways that fix quietly rots are
 * all edits to the job definition, none of which any other check in this repo can see:
 *
 *   * `extends:` REPLACES arrays. A bare `before_script:` that forgets
 *     `!reference [.pentest-dast-base, before_script]` silently drops the base's FATAL
 *     missing-harness check and the pinned nuclei install (`--nuclei` then self-skips).
 *   * the harness must be fetched BEFORE that reference, or the base's check inspects an
 *     empty directory and fails (or, reordered, passes against a stale one).
 *   * PENTEST_HARNESS_DIR must point at the fetched tree.
 *   * a literal git host instead of one derived from CI_REPOSITORY_URL breaks on the
 *     in-cluster GitLab and embeds a host in git.
 *   * restating `rules:` copies the template's arrays and silently drifts from them.
 *   * `needs: []` — otherwise a failed build:image (correctly not allow_failure) removes
 *     the whole pentest stage from the pipeline, silently.
 *   * dropping `allow_failure: true` would turn a finding into a red pipeline; it is
 *     deliberate policy, so it is pinned too.
 *
 * The checks run against the file on disk, and again against deliberately broken copies,
 * so a green tick proves they can fail. Comments are stripped first so a commented-out
 * line can never satisfy a check.
 *
 * Run: `npm run test:headers` (node --test, no dependencies).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CI = readFileSync(join(import.meta.dirname, '..', '.gitlab-ci.yml'), 'utf8');

/** Drop whole-line and trailing ` #` comments (none of the lines checked quote a `#`). */
function stripComments(src) {
  return src
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

/** The body of a top-level job: everything after `name:` up to the next column-0 key. */
function jobBlock(src, name) {
  const lines = stripComments(src).split('\n');
  const start = lines.findIndex((l) => l === `${name}:`);
  if (start < 0) return null;
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break;
    body.push(l);
  }
  return body.join('\n');
}

/** Every reason the DAST wiring could not scan. Empty means structurally capable. */
function problems(src) {
  const out = [];
  const code = stripComments(src);
  if (!/^\s+- project: 'hugmesh\/hugmesh-generator'\s*$/m.test(code) ||
      !/^\s+file: '\/tests\/pentest\/ci\/pentest-stage\.gitlab-ci\.yml'\s*$/m.test(code)) {
    out.push('the pentest template is not included from hugmesh/hugmesh-generator');
  }
  const b = jobBlock(src, 'pentest:dast');
  if (b === null) return [...out, 'there is no pentest:dast job'];

  if (!/^\s+extends: \.pentest-dast-baseline\s*$/m.test(b)) out.push('does not extend .pentest-dast-baseline');
  if (!/^\s+allow_failure: true\s*$/m.test(b)) out.push('allow_failure: true is gone (deliberate policy)');
  if (!/^\s+needs: \[\]\s*$/m.test(b)) out.push('needs: [] is missing, so a failed build removes the scan');
  if (/^\s+rules:/m.test(b)) out.push('restates rules: instead of inheriting them');
  if (/when:\s*manual/.test(b)) out.push('the scan is manual instead of automatic');
  if (!/^\s+PENTEST_HARNESS_DIR: "\$\{CI_PROJECT_DIR\}\/\.pentest-harness\/tests\/pentest"\s*$/m.test(b)) {
    out.push('PENTEST_HARNESS_DIR does not point at the fetched harness');
  }
  if (/https?:\/\//.test(b)) out.push('a literal git host is embedded instead of one derived from CI_REPOSITORY_URL');

  const bs = b.split('\n');
  const idx = (re) => bs.findIndex((l) => re.test(l));
  const clone = idx(/git clone .*hugmesh-generator/);
  const ref = idx(/^\s+- !reference \[\.pentest-dast-base, before_script\]\s*$/);
  const derive = idx(/CI_REPOSITORY_URL/);
  if (!/^\s+before_script:\s*$/m.test(b)) out.push('no before_script');
  if (clone < 0) out.push('never clones hugmesh-generator');
  if (derive < 0 || (clone >= 0 && derive > clone)) out.push('the org base is not derived from CI_REPOSITORY_URL before the clone');
  if (!/git clone --depth 1 --branch main /.test(b)) out.push('clone is not pinned to main, the ref the include pins');
  if (ref < 0) out.push('the base before_script is not spliced back with !reference (extends: replaces arrays)');
  if (clone >= 0 && ref >= 0 && ref < clone) out.push('the base before_script runs BEFORE the harness is fetched');
  return out;
}

test('the real .gitlab-ci.yml wires a pentest:dast that can actually scan', () => {
  assert.deepEqual(problems(CI), []);
});

/** Apply `edit` to the real file; assert the copy really changed and is now rejected. */
function mutationIsCaught(name, edit, expected) {
  test(`mutation caught: ${name}`, () => {
    const mutated = edit(CI);
    assert.notEqual(mutated, CI, 'the mutation did not change the file, so it proves nothing');
    const found = problems(mutated);
    assert.ok(found.some((p) => p.includes(expected)), `expected "${expected}" in ${JSON.stringify(found)}`);
  });
}

mutationIsCaught('drop the !reference splice', (s) =>
  s.replace(/^\s+- !reference \[\.pentest-dast-base, before_script\]\n/m, ''), '!reference');
mutationIsCaught('splice BEFORE the clone', (s) => {
  const ref = '    - !reference [.pentest-dast-base, before_script]\n';
  return s.replace(ref, '').replace(/^(  before_script:\n)(?=(?:.*\n)*?    - rm -rf "\$\{CI_PROJECT_DIR\}\/\.pentest-harness")/m, `$1${ref}`);
}, 'BEFORE the harness');
mutationIsCaught('point at the unfetched default dir', (s) =>
  s.replace(/PENTEST_HARNESS_DIR: "[^"]*"/, 'PENTEST_HARNESS_DIR: "tests/pentest"'), 'PENTEST_HARNESS_DIR');
mutationIsCaught('drop allow_failure', (s) =>
  s.replace(/(pentest:dast:[\s\S]*?)  allow_failure: true\n/, '$1'), 'allow_failure');
mutationIsCaught('drop needs: []', (s) =>
  s.replace(/(pentest:dast:[\s\S]*?)  needs: \[\]\n/, '$1'), 'needs: []');
mutationIsCaught('restate rules', (s) =>
  s.replace(/(pentest:dast:[\s\S]*?)(  before_script:)/, "$1  rules:\n    - if: '$CI_COMMIT_BRANCH'\n$2"), 'rules');
mutationIsCaught('literal git host', (s) =>
  s.replace(/"\$\{ORG_BASE\}\/hugmesh-generator\.git"/, '"https://github.com/hugmesh/hugmesh-generator.git"'), 'literal git host');
mutationIsCaught('stop cloning', (s) =>
  s.replace(/git clone --depth 1 --branch main/, 'echo'), 'never clones');
mutationIsCaught('drop the generator include', (s) =>
  s.replace("- project: 'hugmesh/hugmesh-generator'", "- project: 'hugmesh/other'"), 'not included');
