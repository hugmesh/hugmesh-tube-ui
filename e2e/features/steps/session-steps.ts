// Session / login / navigation step definitions backing the tube-ui features.
//
// Two flavours of "logged in":
//   - `Given "X" is logged in`         — full Casdoor round-trip via login()
//     (LIVE; only reached by @cluster scenarios in wave 2b).
//   - `Given "X" has a seeded session` — writes hug.session directly via an
//     addInitScript (OFFLINE-capable; exercises the pure client-side guard
//     behaviour the tube guards enforce: tubeReadGuard / tubeManageGuard and the
//     canUse / canManage / canManageAll signals).
//
// The navigation steps assert the guard outcome. NOTE the tube boundary is NOT
// /login: the host already authgated the user into /tube (route-access
// ROLE_TUBE), so a within-tube denial routes to /tube/forbidden — the
// privilege-boundary screen — not to /login. All such steps live in @cluster
// features today because they need the host shell to be serving the remote;
// bddgen still compiles them so `--list` proves they parse.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { pageRegistry, ctxRegistry, responseState, activeUser } from './_registry';
import {
  SeedUser,
  login,
  seedSession,
  clearSession,
  newE2eContext,
} from '../../tests/helpers/roles';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Session priming ───────────────────────────────────────────────────────

Given('a clean session', async ({ page }) => {
  await clearSession(page);
});

Given('{string} is logged in', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  await login(page, u);
  pageRegistry.set(u.username, page);
  activeUser.name = u.username;
});

Given('{string} has a seeded session', async ({ page, user }, username: string) => {
  const u: SeedUser = user(username);
  // addInitScript must run BEFORE the first navigation, so register the page and
  // seed; the navigation step that follows picks the session up on load.
  await seedSession(page, u);
  pageRegistry.set(u.username, page);
  activeUser.name = u.username;
});

Given('{string} has a seeded session in their own context', async ({ browser, user }, username: string) => {
  // Cross-user matrix: give each user an isolated context so two identities can
  // coexist in one scenario without sharing localStorage.
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await seedSession(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
  activeUser.name = u.username;
});

Given('{string} is logged in in their own context', async ({ browser, user }, username: string) => {
  // REAL Casdoor round-trip in an ISOLATED context — the multi-user primitive for
  // scenarios that perform REAL WRITES (grant/timeout/ban/restore/remove, budget,
  // enqueue). Each identity gets its own context so the HttpOnly `bff_` session
  // cookie the write path needs (per the e2e honesty rule: real Casdoor sessions
  // for real writes) is scoped per user and two roles can act live at once. All
  // such scenarios are @cluster (the login()/BFF writes need the live stack).
  const u: SeedUser = user(username);
  const ctx = await newE2eContext(browser);
  const page = await ctx.newPage();
  await login(page, u);
  ctxRegistry.set(u.username, ctx);
  pageRegistry.set(u.username, page);
  activeUser.name = u.username;
});

// ── Navigation ─────────────────────────────────────────────────────────────

When('{string} navigates to {string}', async ({ user }, username: string, path: string) => {
  const u = user(username);
  const page = pageOf(u.username);
  activeUser.name = u.username;
  await page.goto(path, { waitUntil: 'domcontentloaded' });
});

// ── Guard-outcome assertions ────────────────────────────────────────────────

Then('{string} sees the {string} view', async ({ user }, username: string, testid: string) => {
  // ALLOW: the guard passed and the tube child view rendered. Each view carries
  // a stable data-testid hook (or an aria-labelledby heading the a11y steps key
  // off). We accept either a data-testid or the heading id selector form.
  const page = pageOf(user(username).username);
  const byTestId = page.locator(`[data-testid="${testid}"]`);
  const byId = page.locator(`#${testid}`);
  await expect(byTestId.or(byId).first()).toBeVisible({ timeout: 15_000 });
});

Then('{string} is sent to the tube forbidden screen', async ({ user }, username: string) => {
  // DENY: tubeReadGuard / tubeManageGuard returns
  // router.parseUrl('/tube/forbidden') — NOT /login. The URL settles on the
  // in-remote forbidden path and the boundary screen renders.
  const page = pageOf(user(username).username);
  await page.waitForURL(/\/tube\/forbidden(\?|$)/, { timeout: 15_000 });
  await expect(page.locator('#tube-forbidden-title')).toBeVisible();
});

Then('{string} does not see the {string} view', async ({ user }, username: string, testid: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
});

// ── Role-aware nav (the feature-gated / role-cascade surface) ───────────────

Then('{string} sees the {string} nav item', async ({ user }, username: string, path: string) => {
  // The console menubar renders a nav item only for the roles whose show()
  // returns true (My Tube → canUse; Tube Access / Storage Budgets → canManage).
  // The existence of the link IS the role-conditional check.
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="tube-nav-${path}"]`)).toBeVisible({ timeout: 10_000 });
});

Then('{string} does not see the {string} nav item', async ({ user }, username: string, path: string) => {
  const page = pageOf(user(username).username);
  // Anchor the negative on a POSITIVE render signal instead of a raw sleep: the
  // console header (#tube-console-help) is unconditional, so once it is up the
  // menubar template has already run and an absent nav item is a real role
  // decision rather than a slow render.
  await expect(page.locator('#tube-console-help')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-testid="tube-nav-${path}"]`)).toHaveCount(0);
});

Then('{string} sees only the {string} nav item', async ({ user }, username: string, path: string) => {
  // A granted ROLE_TUBE user sees ONLY "My Tube"; the manage items are absent.
  const page = pageOf(user(username).username);
  const items = page.locator('[data-testid^="tube-nav-"]');
  await expect(items).toHaveCount(1);
  await expect(page.locator(`[data-testid="tube-nav-${path}"]`)).toBeVisible();
});

// ── API-level cross-user / default-deny DENY ────────────────────────────────
// The console is display-only; the tube-bff is the real gate. These steps fire a
// same-origin fetch with credentials so the HttpOnly `bff_` session cookie rides
// along (the gateway mints the Bearer server-side), exercising the actual tube-bff
// @PreAuthorize + TubeAccessGuard chain, and capture the status.

When('{string} GETs {string}', async ({ user }, username: string, path: string) => {
  const page = pageOf(user(username).username);
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return r.status;
    },
    path,
  );
});

When('{string} POSTs to {string}', async ({ user }, username: string, path: string) => {
  const page = pageOf(user(username).username);
  responseState.lastStatus = await page.evaluate(
    async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      return r.status;
    },
    path,
  );
});

When('the unauthenticated client GETs {string}', async ({ page }, path: string) => {
  await page.goto('/');
  responseState.lastStatus = await page.evaluate(async (p) => {
    const r = await fetch(p);
    return r.status;
  }, path);
});

Then('the response status is {int}', async ({}, expected: number) => {
  expect(responseState.lastStatus).toBe(expected);
});

Then('the response status is one of {int} or {int}', async ({}, a: number, b: number) => {
  expect([a, b]).toContain(responseState.lastStatus);
});
