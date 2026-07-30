// Accessibility step definitions. The tube-ui carries the org a11y standard:
//   - app.component.html  — `<a class="skip" href="#tube-main">` →
//                           `<main id="tube-main" tabindex="-1">` (skip-link +
//                           programmatically-focusable target).
//   - tube-console.html   — the role-aware menubar is `<nav role="menubar"
//                           aria-label="Tube console">` with roving tabindex
//                           (only the active item is tabbable; Arrow/Home/End
//                           move focus) and routerLinkActive →
//                           aria-current="page". Each item carries an
//                           accessibleName (aria-label) + aria-describedby help.
//   - tube-my.html        — the storage usage bar is a labelled
//                           role="progressbar"; loading/empty/error states are
//                           announced (role="status"/"alert").
//
// These steps assert those contracts against the real shell markup.
//
// STEP-BINDING CONTRACT (playwright-bdd): a handler's positional params after the
// fixtures object bind 1:1 to the cucumber-expression `{...}` captures, in order.
// A step whose Gherkin text carries NO capture must declare NO trailing param —
// otherwise the param arrives `undefined` at runtime (the whole a11y feature was
// latently broken by exactly this). Steps with no user in their text operate on
// the active user's page (set by the preceding session/navigation step) via
// activePage(); steps that DO name a user take that `{string}` and resolve it
// through pageOf().

import { expect } from '@playwright/test';
import { Then, When } from '../support/fixtures';
import { pageRegistry, activePage } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── Skip-link ────────────────────────────────────────────────────────────────

Then('{string} can tab to the skip link', async ({}, username: string) => {
  const page = pageOf(username);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute('href', '#tube-main');
});

Then('activating the skip link moves focus to the main region', async ({}) => {
  const page = activePage();
  await page.locator('a.skip').press('Enter');
  const main = page.locator('main#tube-main');
  await expect(main).toBeFocused();
  // The skip target must be programmatically focusable without being a tab stop.
  await expect(main).toHaveAttribute('tabindex', '-1');
});

// ── ARIA landmarks / labels ──────────────────────────────────────────────────

Then('the tube console menubar has an accessible name', async ({}) => {
  const page = activePage();
  const menubar = page.locator('nav[role="menubar"][aria-label="Tube console"]');
  await expect(menubar).toBeVisible();
});

Then('each tube nav item carries an accessible name and help', async ({}) => {
  const page = activePage();
  const items = page.locator('[data-testid^="tube-nav-"]');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    await expect(item).toHaveAttribute('aria-label', /.+/);
    await expect(item).toHaveAttribute('aria-describedby', /tube-nav-help-.+/);
  }
});

Then('the {string} active nav item is marked as the current page', async ({}, path: string) => {
  const page = activePage();
  await expect(page.locator(`[data-testid="tube-nav-${path}"]`)).toHaveAttribute('aria-current', 'page');
});

// ── Roving tabindex on the menubar ───────────────────────────────────────────

When('{string} focuses the first tube nav item', async ({}, username: string) => {
  const page = pageOf(username);
  await page.locator('[data-testid^="tube-nav-"]').first().focus();
});

Then('arrow-key navigation moves focus along the tube nav items', async ({}) => {
  const page = activePage();
  const items = page.locator('[data-testid^="tube-nav-"]');
  await expect(items.first()).toBeFocused();
  // Roving tabindex (WAI-ARIA menubar): only the active item is tabbable (0),
  // the rest are -1 and reached with the Arrow keys.
  await expect(items.first()).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowRight');
  await expect(items.nth(1)).toBeFocused();
});

// ── Announced states (status / alert / progressbar) ─────────────────────────

Then('the storage usage bar is a labelled progressbar', async ({}) => {
  const page = activePage();
  const bar = page.locator('[data-testid="tube-usage"] [role="progressbar"]');
  await expect(bar).toHaveAttribute('aria-label', /.+/);
  await expect(bar).toHaveAttribute('aria-valuenow', /\d+/);
});

Then('the {string} state is announced via role {string}', async ({}, testid: string, role: string) => {
  const page = activePage();
  const el = page.locator(`[data-testid="${testid}"]`);
  await expect(el).toBeVisible();
  await expect(el).toHaveAttribute('role', role);
});

// ── Focus restoration after a route change ───────────────────────────────────

Then('focus is restored to the main region after navigation', async ({}) => {
  const page = activePage();
  await expect(page.locator('main#tube-main')).toBeFocused();
});
