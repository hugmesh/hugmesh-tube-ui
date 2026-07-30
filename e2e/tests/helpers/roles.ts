import { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Catalogue of Casdoor seed users for the tube-ui (LocalTube) e2e matrix.
 * Adapted from the proven hugmesh.games/e2e helper and the merged wave-2b-1
 * admin-ui harness, keyed to THIS app's session model: the tube-ui (and its
 * host) persist a {@link HugSession} under the `hug.session` localStorage key
 * (see src/app/session.service.ts), whose `roles: string[]` drives the tube
 * guards — tubeReadGuard (TUBE_USE = ROLE_TUBE) and tubeManageGuard
 * (TUBE_MANAGE = ADMIN|SUPERADMIN) — plus the role-composite signals canUse /
 * canManage / canManageAll.
 *
 * ── The tube role model (mirrors hugmesh-tube-bff-api SecurityConfig) ──
 *   TUBE_USE    = ROLE_TUBE          → the "My Tube" user console. NOTE the
 *                 default-deny use floor: ROLE_TUBE is only the route/connect
 *                 floor; the BFF TubeAccessGuard enforces the may-use grant at
 *                 request time (an active tube_access grant AND NOT a ban,
 *                 SUPERADMIN exempt). So a ROLE_TUBE holder still gets a 403 the
 *                 UI renders as "access not yet granted".
 *   TUBE_MANAGE = ADMIN | SUPERADMIN → the "Tube Access" + "Storage Budgets"
 *                 consoles (/bff/tube/admin/**). SUPERADMIN additionally reaches
 *                 the list-all/history manage-all panel (/bff/tube/superadmin/**).
 *
 * The catalogue exercises the THREE coverage classes the wave demands:
 *   - USER-SITUATIONAL  — each tube surface, ALLOW + DENY + disabled/helptext.
 *   - MULTIUSER         — an admin granting a user, the user then using Tube.
 *   - CROSS-USER        — a granted USER DENIED on the manage consoles + the
 *                         media-sign owner wall (no cross-user contentPath).
 *
 * The `kind` tag selects which role-specific assertions a feature drives.
 * Passwords default to `process.env.E2E_PASSWORD` (or `e2e-pass`) unless a
 * per-user override env var is exported.
 */
export type RoleKind = 'tube-user' | 'plain-user' | 'admin' | 'superadmin';

export interface SeedUser {
  /** CLI-friendly username referenced from .feature lines. */
  username: string;
  /** env var the compose overlay routes the cred through. */
  passwordEnv: string;
  /** Identity provider — tube sessions are google- or discord-backed (Google
   *  login is what mirrors the user's YouTube subscriptions). */
  provider: 'google' | 'discord';
  /** The lowercased Casdoor roles this user carries in `hug.session.roles`. */
  roles: string[];
  /** Drives role-specific assertions. */
  kind: RoleKind;
  /** Brand/domain this user belongs to — used by the cross-user/brand scenarios. */
  domain?: string;
}

export const SEED_USERS: SeedUser[] = [
  // ── Superadmin — TUBE_MANAGE + the manage-all list/history panel (canManageAll).
  //    Also exempt from the default-deny use floor on the BFF side.
  { username: 'superadmin', passwordEnv: 'E2E_SUPERADMIN_PASSWORD', provider: 'google', roles: ['superadmin', 'tube'], kind: 'superadmin', domain: 'domain-a' },

  // ── Domain admin — TUBE_MANAGE (the grant/timeout/ban + storage-budget
  //    consoles), but NOT the superadmin-only manage-all panel. Carries 'tube'
  //    too so they can self-serve the My Tube view.
  { username: 'admin', passwordEnv: 'E2E_ADMIN_PASSWORD', provider: 'google', roles: ['admin', 'tube'], kind: 'admin', domain: 'domain-a' },

  // ── Tube user WITH an active use-grant — ROLE_TUBE and (assumed) an active
  //    tube_access grant, so the My Tube console loads its queue/subs. Sees ONLY
  //    "My Tube" in the nav.
  { username: 'tube-user', passwordEnv: 'E2E_TUBE_USER_PASSWORD', provider: 'google', roles: ['tube'], kind: 'tube-user', domain: 'domain-a' },

  // ── A SECOND tube user (own brand) — the cross-user isolation counterpart so
  //    two granted identities can coexist and the media-sign owner wall is
  //    asserted (neither can sign the other's contentPath).
  { username: 'tube-user-2', passwordEnv: 'E2E_TUBE_USER2_PASSWORD', provider: 'discord', roles: ['tube'], kind: 'tube-user', domain: 'domain-a' },

  // ── Tube user under the DEFAULT-DENY use floor — has ROLE_TUBE (so the route
  //    guard admits them and they see "My Tube"), but no active tube_access
  //    grant (or banned), so the BFF returns 403 and the console shows the
  //    "access not yet granted" panel. Modelled by the same role set; the
  //    @cluster live scenario distinguishes via the seeded BFF state, while the
  //    dark scenario asserts the rendered access-denied panel.
  { username: 'tube-user-ungranted', passwordEnv: 'E2E_TUBE_UNGRANTED_PASSWORD', provider: 'google', roles: ['tube'], kind: 'tube-user', domain: 'domain-a' },

  // ── Plain user — no tube role at all; tubeReadGuard sends them to
  //    /tube/forbidden (the within-tube privilege boundary, NOT /login: the host
  //    already authgated them in). The floor of the DENY matrix.
  { username: 'plain-user', passwordEnv: 'E2E_USER_PASSWORD', provider: 'google', roles: [], kind: 'plain-user', domain: 'domain-a' },
];

/** Resolve a seed user's password — env override or `E2E_PASSWORD` fallback —
 *  without throwing on a missing env. */
export function passwordFor(user: SeedUser): string {
  return process.env[user.passwordEnv]
    ?? process.env['E2E_PASSWORD']
    ?? 'e2e-pass';
}

/**
 * Create a fresh browser context that trusts the e2e self-signed cert AND uses
 * the same baseURL as the playwright config. The default `browser.newContext()`
 * does NOT inherit project-level `use` options (Playwright design choice), so a
 * spec that opens a manual context misses `ignoreHTTPSErrors: true` and every
 * HTTPS request fails the cert check — the native-federation manifest fetch is
 * the first casualty. Specs that need multiple users in parallel (the cross-user
 * isolation matrix) MUST call this instead of `browser.newContext()`.
 */
export async function newE2eContext(browser: Browser): Promise<BrowserContext> {
  return await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.E2E_BASE_URL ?? 'https://host.docker.internal:8443',
  });
}

/**
 * Drive the federated login form and wait for `hug.session` in localStorage.
 *
 * @cluster-only — this helper hits a LIVE Casdoor + host shell, so it is only
 * exercised by scenarios tagged `@cluster` today (wave 2b ships dark). It is
 * written now so a later wave can un-skip a feature without rewriting steps.
 *
 * The tube-ui's host shell renders the login micro-frontend; on success the
 * SessionService writes `hug.session` (see set()/broadcast()) and the BFF sets
 * the HttpOnly `bff_` cookie via Set-Cookie. We wait for the `hug.session` key to
 * carry the identity so a follow-up guarded navigation doesn't race the write.
 */
export async function login(page: Page, user: SeedUser): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The login remote exposes its form via formControlName selectors (the public
  // selector contract shared across the HugMesh UIs).
  await page.locator('input[formControlName="username"]').waitFor({ state: 'visible', timeout: 15_000 });
  await page.fill('input[formControlName="username"]', user.username);
  await page.fill('input[formControlName="password"]', passwordFor(user));
  await page.click('button.login-btn');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const raw = window.localStorage.getItem('hug.session');
      if (!raw) return false;
      try {
        return Boolean(JSON.parse(raw).id);
      } catch {
        return false;
      }
    },
    undefined,
    { timeout: 15_000 },
  );
}

/**
 * Seed a {@link HugSession} directly into localStorage WITHOUT a Casdoor round
 * trip. Mirrors the shape SessionService.set() writes, so the tube guards
 * reading the `roles` array behave exactly as in production. Used by the
 * offline/dark scenarios that assert pure client-side guard behaviour (skip-link
 * focus, role-aware nav, the /tube/forbidden boundary) without needing the
 * BFF — and by the live scenarios as a faster alternative to a full login.
 */
export async function seedSession(page: Page, user: SeedUser): Promise<void> {
  const session = {
    id: `${user.provider}:${user.username}@example.test`,
    label: user.username,
    provider: user.provider,
    roles: user.roles,
    registrationComplete: true,
  };
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    ['hug.session', JSON.stringify(session)] as const,
  );
}

/** Clear the session — used between role swaps so a stale identity doesn't carry
 *  into the next scenario's guard check. */
export async function clearSession(page: Page): Promise<void> {
  await page.evaluate(() => window.localStorage.removeItem('hug.session'));
}
