// Google-connect preference-panel step definitions.
//
// The Google account panel (src/app/tube-my.component.html #tube-google) is the
// ONLY user-owned preference on the Tube surface, and it had zero e2e coverage.
// Its interesting states are the component's REACTION to specific BFF envelopes:
//   - degraded         — GET /google-connect/status FAILED → disclose the real
//                        failure + DISABLE connect/sync (tube-google-degraded).
//   - reauth-required  — status says connected but reauthRequired → sync disabled
//                        with help-text + a Reconnect button (tube-google-reauth).
//   - no consent URL   — GET /authorize answers WITHOUT authorizeUrl → the click
//                        discloses that and does NOT navigate (tube-google-error).
//   - connect          — /authorize returns a URL → full-page navigation to it.
//   - disconnect       — POST /disconnect flips the panel back to the connect offer.
//   - sync             — POST /subscriptions/sync populates the channel list + notice.
//
// These are PURE CLIENT-SIDE rendering behaviours, so per the e2e honesty rule
// they use a SEEDED session (no real write) + Playwright route interception to
// serve the exact BFF envelope each state needs — deterministic, no fragile live
// backend state to reproduce. The feature stays @cluster because this harness has
// no offline app server (the served remote shell is still required); interception
// replaces the tube-bff, so no live tube-bff is needed to run it.
//
// Install order per scenario:
//   Given "X" has a seeded session
//   And the Google-connect BFF is stubbed          # resets state + installs routes
//   And <keyword steps that tweak the stubbed envelope>
//   When "X" navigates to "/tube/my"

import { expect } from '@playwright/test';
import { Given, Then, When } from '../support/fixtures';
import { activePage, pageRegistry } from './_registry';

function pageOf(username: string) {
  const page = pageRegistry.get(username);
  if (!page) throw new Error(`No page registered for "${username}" — add a session step first.`);
  return page;
}

type StatusKind = 'not-connected' | 'connected' | 'reauth' | 'degraded';

/** Per-scenario mutable stub state the route closures read at request time.
 *  Reset by the install step (module state persists across scenarios in a
 *  worker, so every scenario MUST call the install step first). */
interface GoogleStub {
  status: StatusKind;
  /** authorize response: null = no consent URL (200 with {}); a string = the
   *  consent URL the component should full-page-navigate to. */
  authorizeUrl: string | null;
  /** POST /disconnect returns this connection status. */
  disconnectedConnected: boolean;
  /** Whether a sync POST has happened this scenario (flips the subs list). */
  synced: boolean;
  /** How many channels sync reports + the subscriptions returned once synced. */
  syncCount: number;
  syncedChannelId: string;
}

const g: GoogleStub = reset();

function reset(): GoogleStub {
  return {
    status: 'not-connected',
    authorizeUrl: null,
    disconnectedConnected: false,
    synced: false,
    syncCount: 0,
    syncedChannelId: '',
  };
}

function statusBody(): Record<string, unknown> {
  switch (g.status) {
    case 'connected':
      return { connected: true, googleEmail: 'e2e-user@gmail.com', connectedAt: '2026-01-01T00:00:00Z', reauthRequired: false };
    case 'reauth':
      return { connected: true, googleEmail: 'e2e-user@gmail.com', connectedAt: '2026-01-01T00:00:00Z', reauthRequired: true };
    case 'not-connected':
    default:
      return { connected: false };
  }
}

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

// ── Install / configure the stubbed Google-connect BFF ───────────────────────

Given('the Google-connect BFF is stubbed', async ({}) => {
  Object.assign(g, reset());
  const page = activePage();
  // Single dispatcher over all /bff/tube/** the My Tube panel touches, so the
  // page renders its Google panel deterministically off the stubbed envelopes.
  await page.route('**/bff/tube/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path.endsWith('/bff/tube/downloads') && method === 'GET') {
      return route.fulfill(json({ jobs: [] }));
    }
    if (path.endsWith('/bff/tube/subscriptions') && method === 'GET') {
      const subs = g.synced
        ? [{ channelId: g.syncedChannelId, channelTitle: 'Synced Channel', thumbnailUrl: null, syncedAt: '2026-01-02T00:00:00Z' }]
        : [];
      return route.fulfill(json({ subscriptions: subs }));
    }
    if (path.endsWith('/bff/tube/subscriptions/sync') && method === 'POST') {
      g.synced = true;
      return route.fulfill(json({ synced: g.syncCount }));
    }
    if (path.endsWith('/bff/tube/google-connect/status') && method === 'GET') {
      if (g.status === 'degraded') {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'connect service unavailable' }) });
      }
      return route.fulfill(json(statusBody()));
    }
    if (path.endsWith('/bff/tube/google-connect/authorize') && method === 'GET') {
      return route.fulfill(json(g.authorizeUrl ? { authorizeUrl: g.authorizeUrl } : {}));
    }
    if (path.endsWith('/bff/tube/google-connect/disconnect') && method === 'POST') {
      return route.fulfill(json({ connected: g.disconnectedConnected }));
    }
    // Any other tube call the panel doesn't need: continue (a live @cluster run
    // reaches the real BFF; a served-shell-only run simply won't fire these).
    return route.fallback();
  });
});

Given('the Google connection status is unavailable', async ({}) => {
  g.status = 'degraded';
});

Given('the Google account is connected', async ({}) => {
  g.status = 'connected';
});

Given('the Google account needs re-authentication', async ({}) => {
  g.status = 'reauth';
});

Given('the Google account is not connected', async ({}) => {
  g.status = 'not-connected';
});

Given('the Google authorize endpoint returns no consent URL', async ({}) => {
  g.authorizeUrl = null;
});

Given('the Google authorize endpoint offers the consent path {string}', async ({}, path: string) => {
  g.authorizeUrl = path;
  // Fulfil the consent target itself so the full-page navigation completes and
  // the test can assert the URL (the real OAuth hop leaves the SPA for Google;
  // here it leaves for a same-origin stub we can observe without a third party).
  const page = activePage();
  await page.route(`**${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>consent stub</title><h1>Google consent</h1>' }),
  );
});

Given('the Google disconnect endpoint reports disconnected', async ({}) => {
  g.disconnectedConnected = false;
});

Given('the subscription sync endpoint will report {int} synced channels for {string}', async ({}, count: number, channelId: string) => {
  g.syncCount = count;
  g.syncedChannelId = channelId;
});

// ── Actions ──────────────────────────────────────────────────────────────────

When('{string} clicks Connect Google', async ({}, username: string) => {
  await pageOf(username).locator('[data-testid="tube-google-connect"]').click();
});

When('{string} clicks Disconnect Google', async ({}, username: string) => {
  await pageOf(username).locator('[data-testid="tube-google-disconnect"]').click();
});

When('{string} clicks Sync subscriptions', async ({}, username: string) => {
  await pageOf(username).locator('[data-testid="tube-google-sync"]').click();
});

// ── Assertions ───────────────────────────────────────────────────────────────

Then('{string} sees the Google degraded disclosure', async ({}, username: string) => {
  // Honest disclosure: the real failure is shown AND connect is disabled (never
  // a guessed "not connected", never a control claiming it can succeed).
  const page = pageOf(username);
  const degraded = page.locator('[data-testid="tube-google-degraded"]');
  await expect(degraded).toBeVisible({ timeout: 15_000 });
  await expect(degraded).toContainText('unavailable');
  const connect = page.locator('[data-testid="tube-google-connect"]');
  await expect(connect).toBeDisabled();
  await expect(page.locator('[data-testid="tube-google-degraded-help"]')).toBeVisible();
});

Then('{string} sees the Google connect action offered', async ({}, username: string) => {
  const page = pageOf(username);
  const connect = page.locator('[data-testid="tube-google-connect"]');
  await expect(connect).toBeVisible({ timeout: 15_000 });
  await expect(connect).toBeEnabled();
  await expect(connect).toHaveText(/Connect Google/);
});

Then('{string} sees the Google reauth-required notice', async ({}, username: string) => {
  const page = pageOf(username);
  await expect(page.locator('[data-testid="tube-google-reauth"]')).toBeVisible({ timeout: 15_000 });
  // Sync is disabled with the reauth help-text; a Reconnect button is offered.
  await expect(page.locator('[data-testid="tube-google-sync"]')).toBeDisabled();
  const syncHelp = page.locator('[data-testid="tube-google-sync-help"]');
  await expect(syncHelp).toBeVisible();
  await expect(syncHelp).toContainText('reconnect');
  await expect(page.locator('[data-testid="tube-google-connect"]')).toHaveText(/Reconnect Google/);
});

Then('{string} sees the no-consent-URL disclosure', async ({}, username: string) => {
  // The click surfaced the real failure and did NOT navigate (still on My Tube).
  const page = pageOf(username);
  const err = page.locator('[data-testid="tube-google-error"]');
  await expect(err).toBeVisible({ timeout: 15_000 });
  await expect(err).toContainText('no Google consent URL');
  await expect(page.locator('#tube-google-title')).toBeVisible();
});

Then('{string} is taken to the Google consent page at {string}', async ({}, username: string, path: string) => {
  // The component full-page-navigated to the BFF-provided consent URL.
  const page = pageOf(username);
  await page.waitForURL((u) => u.pathname === path, { timeout: 15_000 });
  await expect(page.locator('h1')).toHaveText('Google consent');
});

Then('{string} sees the sync success notice for {int} channels', async ({}, username: string, count: number) => {
  const page = pageOf(username);
  const notice = page.locator('[data-testid="tube-my-notice"]');
  await expect(notice).toBeVisible({ timeout: 15_000 });
  await expect(notice).toContainText(`Synced ${count} subscription`);
});

Then('{string} sees the synced channel {string}', async ({}, username: string, channelId: string) => {
  await expect(pageOf(username).locator(`[data-testid="tube-sub-${channelId}"]`)).toBeVisible({ timeout: 15_000 });
});
