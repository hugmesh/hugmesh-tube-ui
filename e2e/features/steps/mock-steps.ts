// Step definitions for the OFFLINE `@mock` lane: the Tube Access + Storage
// Budgets consoles driven against the standalone dev shell (`ng serve tube`,
// mounted at /tube) with a seeded hug.session and page.route() standing in for
// hugmesh-tube-bff-api. No cluster, no Casdoor, no host shell.
//
// The mocks answer in the EXACT wire shapes the bff emits (TubeAccessDto.Access,
// TubeDownloadDto.Usage, AccessList — see src/app/tube.service.ts):
//   accepted  200 + the row the console renders
//   refused   403 {"error":"Forbidden"} — the @PreAuthorize / path-gate denial
//
// FAIL-CLOSED: `the tube-bff is mocked` installs a catch-all for /bff/** that
// answers 501, BEFORE the specific routes (Playwright runs the most recently
// registered matching route first). Without it an unmocked call would fall
// through to the dev server, which answers any path with index.html and 200 —
// a scenario could then pass while asserting nothing about the backend. Every
// request the page sends under /bff/ is also logged (mockLog) so a scenario can
// assert what the UI actually sent, not only what it rendered.

import { expect, Route } from '@playwright/test';
import { Given, Then } from '../support/fixtures';
import { activePage, mockLog } from './_registry';

const NOW = '2026-09-30T00:00:00Z';
const GIB = 1024 * 1024 * 1024;

function json(status: number, body: unknown) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}
const FORBIDDEN = json(403, { error: 'Forbidden' });

function accessRow(userSubject: string, accessType: 'use' | 'banned', extra: Record<string, unknown> = {}) {
  return {
    id: `acc-${accessType}-${userSubject}`,
    domain: 'domain-a',
    userSubject,
    accessType,
    state: 'active',
    grantedBySubject: 'google:admin@example.test',
    reason: null,
    createdAt: NOW,
    expiresAt: null,
    revokedAt: null,
    ...extra,
  };
}

function bodyOf(route: Route): Record<string, unknown> {
  try {
    return JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── Installing the mock ─────────────────────────────────────────────────────

Given('the tube-bff is mocked', async () => {
  const page = activePage();
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith('/bff/')) {
      mockLog.push({ method: req.method(), path: url.pathname + url.search, body: req.postData() });
    }
  });
  await page.route('**/bff/**', (route) =>
    route.fulfill(json(501, { error: 'unmocked /bff call in the offline lane' })),
  );
});

Given('the tube-bff grants use to any user', async () => {
  await activePage().route('**/bff/tube/admin/access/grant', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill(json(200, accessRow(String(bodyOf(route)['userSubject']), 'use')));
  });
});

Given('the tube-bff bans any user', async () => {
  await activePage().route('**/bff/tube/admin/access/ban', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill(json(200, accessRow(String(bodyOf(route)['userSubject']), 'banned')));
  });
});

Given('the tube-bff times out any user', async () => {
  await activePage().route('**/bff/tube/admin/access/timeout', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = bodyOf(route);
    const expiresAt = new Date(Date.now() + Number(body['ttlSeconds']) * 1000).toISOString();
    return route.fulfill(json(200, accessRow(String(body['userSubject']), 'banned', { expiresAt })));
  });
});

Given('the tube-bff lifts bans and removes grants', async () => {
  await activePage().route('**/bff/tube/admin/access/*/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    return route.fulfill(json(200, { state: 'revoked' }));
  });
});

Given('the tube-bff refuses every access change with 403', async () => {
  await activePage().route('**/bff/tube/admin/access/**', (route) => route.fulfill(FORBIDDEN));
});

Given('the tube-bff lists the active overrides {string}', async ({}, subjects: string) => {
  const rows = subjects
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => accessRow(s, 'banned'));
  await activePage().route('**/bff/tube/superadmin/access', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(json(200, { access: rows }));
  });
});

Given('the tube-bff has no active overrides', async () => {
  await activePage().route('**/bff/tube/superadmin/access', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(json(200, { access: [] }));
  });
});

Given('the tube-bff serves access history for {string}', async ({}, subject: string) => {
  await activePage().route('**/bff/tube/superadmin/access/*/history', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const rows = [
      accessRow(subject, 'use', { state: 'revoked', revokedAt: NOW }),
      accessRow(subject, 'banned'),
    ];
    return route.fulfill(json(200, { access: rows }));
  });
});

Given('the tube-bff applies any storage budget with {int} GB already used', async ({}, usedGb: number) => {
  await activePage().route('**/bff/tube/admin/storage-budget', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = bodyOf(route);
    return route.fulfill(
      json(200, {
        domain: 'domain-a',
        userSubject: String(body['userSubject']),
        usedBytes: usedGb * GIB,
        budgetBytes: Number(body['budgetBytes']),
        updatedAt: NOW,
      }),
    );
  });
});

Given('the tube-bff refuses every storage budget with 403', async () => {
  await activePage().route('**/bff/tube/admin/storage-budget', (route) => route.fulfill(FORBIDDEN));
});

// ── What the UI actually sent ───────────────────────────────────────────────

function matching(request: string) {
  const [method, ...rest] = request.split(' ');
  const path = rest.join(' ');
  return mockLog.filter((r) => r.method === method && r.path.split('?')[0] === path);
}

Then('the tube-bff received {int} request(s) to {string}', async ({}, count: number, request: string) => {
  expect(matching(request), `requests matching ${request}; saw ${JSON.stringify(mockLog)}`).toHaveLength(count);
});

Then('the request body sent to {string} had {string} equal to {string}', async ({}, request: string, field: string, expected: string) => {
  const sent = matching(request);
  expect(sent.length, `no ${request} was sent; saw ${JSON.stringify(mockLog)}`).toBeGreaterThan(0);
  const body = JSON.parse(sent[sent.length - 1].body ?? '{}') as Record<string, unknown>;
  expect(String(body[field])).toBe(expected);
});

// ── Rendered states the @cluster steps do not cover ─────────────────────────

Then('{string} sees the access error containing {string}', async ({}, _username: string, text: string) => {
  await expect(activePage().locator('[data-testid="tube-access-error"]')).toContainText(text, { timeout: 15_000 });
});

Then('{string} sees the budget error containing {string}', async ({}, _username: string, text: string) => {
  await expect(activePage().locator('[data-testid="tube-budget-error"]')).toContainText(text, { timeout: 15_000 });
});

Then('{string} sees the validation alert {string}', async ({}, _username: string, text: string) => {
  await expect(activePage().getByRole('alert').filter({ hasText: text })).toBeVisible();
});

Then('{string} sees no access change result', async ({}, _username: string) => {
  // Anchored on the form having been submitted/validated, so the absence is a
  // real decision and not a not-yet-rendered panel.
  await expect(activePage().locator('#tube-access-title')).toBeVisible();
  await expect(activePage().locator('[data-testid="tube-access-result"]')).toHaveCount(0);
});

Then('{string} sees the budget row for {string} reading {string}', async ({}, _username: string, subject: string, usage: string) => {
  const row = activePage().locator(`[data-testid="tube-budget-row-${subject}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(usage);
});

Then('{string} sees the budget usage bar for {string} at {int} percent', async ({}, _username: string, subject: string, pct: number) => {
  const bar = activePage().locator(`[data-testid="tube-budget-row-${subject}"] [role="progressbar"]`);
  await expect(bar).toHaveAttribute('aria-valuenow', String(pct));
});

Then('{string} sees no budgets listed yet', async ({}, _username: string) => {
  await expect(activePage().locator('[data-testid="tube-budgets-empty"]')).toBeVisible();
});
