// Tube-specific step definitions — the LocalTube surfaces grounded against the
// real component markup (src/app/tube-*.component.html):
//
//   tube-console.component.html  — role-aware menubar (data-testid="tube-nav-*")
//                                  + #tube-main skip target lives in app shell.
//   tube-my.component.html        — the "My Tube" user console: subscriptions
//                                  list (tube-sub-*), download queue (tube-job-*,
//                                  tube-job-state-*), storage usage progressbar
//                                  (tube-usage), the Enqueue button
//                                  (tube-enqueue) DISABLED + tube-enqueue-help
//                                  when budget is full, the access-denied panel
//                                  (tube-my-access-denied), and the per-done-job
//                                  player (tube-watch-load-*, tube-watch-video-*,
//                                  tube-watch-error-*).
//   tube-access.component.html    — grant/timeout/ban form + superadmin-only
//                                  manage-all panel (tube-access-manage).
//   tube-budgets.component.html   — set-budget form (tube-budget-*).
//   tube-forbidden.component.html — the within-tube boundary screen.
//
// These steps assert the user-situational, multiuser, and cross-user surfaces.

import { expect } from '@playwright/test';
import { Given, Then, When } from '../support/fixtures';
import { pageRegistry, responseState, capturedState, activePage } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

// ── My Tube: subscriptions (the user views their OWN subscribed-channel content)

Then('{string} sees their subscribed channels list', async ({ user }, username: string) => {
  // The owner-scoped GET /bff/tube/subscriptions list — the single source of
  // truth for the user's subscribed channels (region is aria-labelledby
  // #tube-subs-title). Either the channel rows render OR the empty-state hint;
  // both are valid "their own list" states. We assert the region heading exists.
  const page = pageOf(user(username).username);
  await expect(page.locator('#tube-subs-title')).toBeVisible({ timeout: 15_000 });
});

Then('{string} sees the subscribed channel {string}', async ({ user }, username: string, channelId: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="tube-sub-${channelId}"]`)).toBeVisible();
});

Then('{string} sees the empty-subscriptions hint', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-subs-empty"]')).toBeVisible();
});

// ── My Tube: download queue + storage usage ─────────────────────────────────

Then('{string} sees their download queue', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('#tube-queue-title')).toBeVisible();
});

Then('{string} sees the storage usage bar', async ({ user }, username: string) => {
  // role="progressbar" with aria-valuenow/min/max — the a11y-labelled usage bar.
  const page = pageOf(user(username).username);
  const bar = page.locator('[data-testid="tube-usage"] [role="progressbar"]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuemin', '0');
  await expect(bar).toHaveAttribute('aria-valuemax', '100');
});

Then('{string} sees the download job {string} in state {string}', async ({ user }, username: string, jobId: string, state: string) => {
  const page = pageOf(user(username).username);
  const badge = page.locator(`[data-testid="tube-job-state-${jobId}"]`);
  await expect(badge).toHaveText(state);
});

// ── My Tube: enqueue ALLOW + disabled/helptext (budget-full) ────────────────

Then('{string} sees the enqueue action enabled', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const btn = page.locator('[data-testid="tube-enqueue"]');
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
});

Then('{string} sees the enqueue action disabled with the budget-full helptext', async ({ user }, username: string) => {
  // The canonical disabled+helptext case: when the queue contains `skipped`
  // jobs, budgetFull() is true → the Enqueue button is [disabled] and the
  // tube-enqueue-help note reads "Your storage budget is full — an admin can
  // raise it." The button keeps aria-describedby="tube-enqueue-help" so a screen
  // reader announces WHY.
  const page = pageOf(user(username).username);
  const btn = page.locator('[data-testid="tube-enqueue"]');
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('aria-describedby', 'tube-enqueue-help');
  const help = page.locator('[data-testid="tube-enqueue-help"]');
  await expect(help).toBeVisible();
  await expect(help).toContainText('budget is full');
});

// ── My Tube: default-deny use floor (403 → access-denied panel) ─────────────

Then('{string} sees the access-not-granted panel', async ({ user }, username: string) => {
  // ROLE_TUBE is the route floor; use is grant-only. When the BFF
  // TubeAccessGuard returns 403, the My Tube console renders the explanatory
  // panel rather than a generic error.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-my-access-denied"]')).toBeVisible({ timeout: 15_000 });
});

// ── My Tube: in-platform viewing of OWN completed downloads ─────────────────

Then('{string} can load the video for the completed download {string}', async ({ user }, username: string, jobId: string) => {
  // Only `done` jobs get a player; the sign-on-demand request signs THIS job's
  // OWN contentPath (from the owner-scoped queue), never an arbitrary path.
  const page = pageOf(user(username).username);
  const loadBtn = page.locator(`[data-testid="tube-watch-load-${jobId}"]`);
  await expect(loadBtn).toBeVisible();
  await loadBtn.click();
  await expect(page.locator(`[data-testid="tube-watch-video-${jobId}"]`)).toBeVisible({ timeout: 15_000 });
});

Given('a completed download {string} is present but its media sign returns 403', async ({}, jobId: string) => {
  // Force the honest-failure path deterministically: a `done` job renders a Load
  // button, but GET /bff/tube/media/sign 403s (expired/owner-rejected). Seeded
  // session + interception = pure client-side error rendering (no live BFF), so
  // the "error + retry, never a broken <video>" promise can be asserted dark-safe.
  const page = activePage();
  const contentPath = '/domain-a/google:tube-user@example.test/vid.mp4';
  await page.route('**/bff/tube/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const m = route.request().method();
    if (p.endsWith('/bff/tube/downloads') && m === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobs: [{
            id: jobId, domain: 'domain-a', userSubject: 'google:tube-user@example.test',
            channelId: 'chan-1', videoId: 'vid-1', title: 'My Completed Video', state: 'done',
            claimedBy: null, claimedAt: null, attempts: 1, lastError: null, bytes: 1000,
            contentPath, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:05:00Z',
          }],
        }),
      });
    }
    if (p.endsWith('/bff/tube/subscriptions') && m === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ subscriptions: [] }) });
    }
    if (p.endsWith('/bff/tube/google-connect/status') && m === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: false }) });
    }
    if (p.endsWith('/bff/tube/media/sign') && m === 'GET') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'not your content / expired' }) });
    }
    return route.fallback();
  });
});

When('{string} tries to load the video for the completed download {string}', async ({ user }, username: string, jobId: string) => {
  // Click Load WITHOUT asserting success — the sign call is stubbed to 403 so the
  // card must transition to the error+retry state, asserted by the next step.
  const page = pageOf(user(username).username);
  await page.locator(`[data-testid="tube-watch-load-${jobId}"]`).click();
});

Then('{string} sees a retry instead of a broken player for {string}', async ({ user }, username: string, jobId: string) => {
  // A sign 403/expired shows an error + retry, never a broken <video>.
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="tube-watch-error-${jobId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="tube-watch-retry-${jobId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="tube-watch-video-${jobId}"]`)).toHaveCount(0);
});

// ── Tube Access console (admin) — grant/ban form + ban-precedence note ──────

When('{string} selects the {string} access action', async ({ user }, username: string, action: string) => {
  const page = pageOf(user(username).username);
  await page.locator(`[data-testid="tube-access-action-${action}"]`).check();
});

When('{string} enters the access user subject {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-user"]').fill(subject);
});

When('{string} applies the access change', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-submit"]').click();
});

Then('{string} sees the ban-precedence note', async ({ user }, username: string) => {
  // Selecting "ban" reveals the note that a ban takes precedence over any grant.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-access-ban-note"]')).toBeVisible();
});

Then('{string} sees the access change result for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  const result = page.locator('[data-testid="tube-access-result"]');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toContainText(subject);
});

// ── Superadmin-only manage-all panel (canManageAll) ─────────────────────────

Then('{string} sees the manage-all overrides panel', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-access-manage"]')).toBeVisible({ timeout: 15_000 });
});

Then('{string} does not see the manage-all overrides panel', async ({ user }, username: string) => {
  // An ADMIN (non-superadmin) sees the write form but NOT the list-all/history
  // panel (canManageAll = isSuperadmin only). Anchor the negative on a POSITIVE
  // render signal from the same component — the access console's own heading —
  // instead of a raw sleep: once #tube-access-title is up the template has run,
  // so an absent manage panel means canManageAll() was false, not a slow render.
  const page = pageOf(user(username).username);
  await expect(page.locator('#tube-access-title')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="tube-access-manage"]')).toHaveCount(0);
});

// ── Storage Budgets console (admin) ─────────────────────────────────────────

When('{string} sets a budget of {string} GB for {string}', async ({ user }, username: string, gb: string, subject: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-budget-user"]').fill(subject);
  await page.locator('[data-testid="tube-budget-gb"]').fill(gb);
  await page.locator('[data-testid="tube-budget-submit"]').click();
});

Then('{string} sees the applied budget row for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="tube-budget-row-${subject}"]`)).toBeVisible({ timeout: 15_000 });
});

// ── Tube Forbidden (the within-tube boundary screen) ────────────────────────

Then('{string} sees the back-to-my-tube link', async ({ user }, username: string) => {
  // Offered only when canUse() — a granted user who hit a manage-only view.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-forbidden-back"]')).toBeVisible();
});

Then('{string} does not see the back-to-my-tube link', async ({ user }, username: string) => {
  // A plain user with no tube role gets no "Back to My Tube" offer.
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-forbidden-back"]')).toHaveCount(0);
});

// ── Tube Access console — timeout duration + result-type assertions ──────────

When('{string} sets the timeout duration to {string} hours', async ({ user }, username: string, hours: string) => {
  // The timeout hours field only appears once the 'timeout' action is selected.
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-ttl"]').fill(hours);
});

Then('{string} sees the access result of type {string} with a future expiry', async ({ user }, username: string, accessType: string) => {
  // A TIMEOUT is modelled as a bounded ban: the result row reports
  // accessType='banned' (not 'use') AND a non-permanent Expires value. Assert
  // BOTH — the type badge AND that the expiry is a real date, not the
  // "never (permanent)" a permanent ban/grant shows.
  const page = pageOf(user(username).username);
  const result = page.locator('[data-testid="tube-access-result"]');
  await expect(result).toBeVisible({ timeout: 15_000 });
  await expect(result).toContainText(accessType);
  await expect(result).not.toContainText('never (permanent)');
});

// ── Tube Access console — restore-ban / remove-grant DELETE round trips ──────

When('{string} restores the ban from the result panel', async ({ user }, username: string) => {
  // DELETE /bff/tube/admin/access/banned/{user} via the result-panel button.
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-restore"]').click();
});

When('{string} removes the grant from the result panel', async ({ user }, username: string) => {
  // DELETE /bff/tube/admin/access/use/{user} via the result-panel button.
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-remove"]').click();
});

Then('{string} sees the access notice containing {string}', async ({ user }, username: string, text: string) => {
  const page = pageOf(user(username).username);
  const notice = page.locator('[data-testid="tube-access-notice"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText(text);
});

// ── Timeout auto-restore lifecycle (short TTL via the BFF + bounded poll) ─────

When('{string} times out {string} for {int} seconds via the BFF', async ({ user }, adminName: string, subject: string, seconds: number) => {
  // The console form only allows whole-HOUR timeouts, which cannot auto-restore
  // inside a test. Drive a SHORT ttlSeconds directly against the real endpoint
  // with the admin's authenticated context (real bff_ cookie) so the auto-restore
  // can be observed within the scenario. The response status is captured so the
  // caller asserts the write succeeded.
  const page = pageOf(user(adminName).username);
  responseState.lastStatus = await page.evaluate(
    async ([subj, secs]) => {
      const r = await fetch('/bff/tube/admin/access/timeout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userSubject: subj, ttlSeconds: secs }),
      });
      return r.status;
    },
    [subject, seconds] as const,
  );
});

Then('{string} regains My Tube access within {int} seconds', async ({ user }, username: string, seconds: number) => {
  // Auto-restore is lazy (the TubeAccessGuard stops counting the timeout once its
  // expiry passes), so bounded-POLL by re-navigating until the granted state (the
  // subscriptions region) renders — no fixed sleep, a real deadline.
  const page = pageOf(user(username).username);
  await expect
    .poll(
      async () => {
        await page.goto('/tube/my', { waitUntil: 'domcontentloaded' });
        // Each attempt gets its OWN bounded render window. `domcontentloaded`
        // returns before Angular has bootstrapped and read the BFF, so an
        // immediate isVisible() would answer false on EVERY attempt and the poll
        // could never observe the restore — a poll that can only ever time out
        // proves nothing. waitFor() with a short per-attempt deadline keeps the
        // whole check bounded (no sleep) while letting a genuine restore win.
        return await page
          .locator('#tube-subs-title')
          .waitFor({ state: 'visible', timeout: 4_000 })
          .then(() => true)
          .catch(() => false);
      },
      { timeout: seconds * 1000, intervals: [1000, 2000, 2000, 3000, 3000] },
    )
    .toBe(true);
});

// ── Superadmin manage-all audit surface (active list + history) ──────────────

When('{string} refreshes the active overrides', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-refresh"]').click();
});

Then('{string} sees the active override row for {string}', async ({ user }, username: string, subject: string) => {
  // The write an admin just made must surface in the superadmin Active-overrides
  // list as tube-access-row-<subject> — the cross-role write→read audit journey.
  const page = pageOf(user(username).username);
  await expect(page.locator(`[data-testid="tube-access-row-${subject}"]`)).toBeVisible({ timeout: 15_000 });
});

When('{string} loads the access history for {string}', async ({ user }, username: string, subject: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-access-history-user"]').fill(subject);
  await page.locator('[data-testid="tube-access-history-load"]').click();
});

Then('{string} sees a non-empty access history', async ({ user }, username: string) => {
  // The full grant/timeout/ban trail rendered — the history list is present and
  // the empty-history hint is NOT (proves the audit trail actually surfaced).
  const page = pageOf(user(username).username);
  await expect(page.locator('[data-testid="tube-access-history-list"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="tube-access-history-empty"]')).toHaveCount(0);
});

// ── My Tube — enqueue ALLOW mutation (the headline user write) ────────────────

When('{string} enqueues from their subscriptions', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  await page.locator('[data-testid="tube-enqueue"]').click();
});

Then('{string} sees the enqueue success notice', async ({ user }, username: string) => {
  const page = pageOf(user(username).username);
  const notice = page.locator('[data-testid="tube-my-notice"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText('Enqueued');
});

Then('{string} sees the My Tube notice containing {string}', async ({ user }, username: string, text: string) => {
  // The shared My Tube status notice (tube-my-notice) — used by enqueue, sync and
  // disconnect. Distinct from the Tube Access console notice (tube-access-notice).
  const page = pageOf(user(username).username);
  const notice = page.locator('[data-testid="tube-my-notice"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText(text);
});

Then('{string} sees a download job in state {string}', async ({ user }, username: string, state: string) => {
  // At least one queue row now carries the given state badge (exact text) — the
  // enqueue actually produced new work (id is BFF-assigned, so match by state).
  const page = pageOf(user(username).username);
  const badge = page
    .locator('[data-testid^="tube-job-state-"]')
    .filter({ hasText: new RegExp(`^${state}$`) });
  await expect(badge.first()).toBeVisible({ timeout: 15_000 });
});

// ── Cross-user media-sign owner wall — VICTIM-CREATES-FIRST (no hard-coded path)

When('{string} reads a media contentPath from their own download queue', async ({ user }, username: string) => {
  // Victim-first: read a REAL contentPath off the victim's OWN owner-scoped queue
  // (GET /bff/tube/downloads) — a `done` job with a contentPath. That exact path
  // is what the attacker then tries (and must be denied) — so the 403 proves the
  // owner wall, not merely that a fabricated path is rejected.
  const page = pageOf(user(username).username);
  const path = await page.evaluate(async () => {
    const r = await fetch('/bff/tube/downloads', { credentials: 'include' });
    if (!r.ok) return '';
    const body = await r.json();
    const jobs: Array<{ state: string; contentPath: string | null }> = body?.jobs ?? [];
    const done = jobs.find((j) => j.state === 'done' && !!j.contentPath);
    return done?.contentPath ?? '';
  });
  expect(path, 'victim has no completed download with a contentPath to test the owner wall').not.toBe('');
  capturedState.contentPath = path;
});

When('{string} tries to sign the captured contentPath', async ({ user }, username: string) => {
  // The attacker signs the VICTIM'S real contentPath (captured above) via
  // GET /bff/tube/media/sign?path=<victimPath>. The BFF re-checks the path embeds
  // the CALLER'S own /<domain>/<subject>/ prefix → 403 for a cross-user path.
  const page = pageOf(user(username).username);
  responseState.lastStatus = await page.evaluate(async (path) => {
    const r = await fetch(`/bff/tube/media/sign?path=${encodeURIComponent(path)}`, {
      credentials: 'include',
    });
    return r.status;
  }, capturedState.contentPath);
});
