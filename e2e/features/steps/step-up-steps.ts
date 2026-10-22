// Step definitions for the OFFLINE `@mock` step-up scenarios (features/mock/step-up.feature).
// Wire shapes mirror what hugmesh-gateway really sends on an mfa_required deny:
//   403 + X-Route-Denied + X-Step-Up-Required: X-Mfa-StepUp, EMPTY body
// and what POST /bff/mfa/challenge returns on success ({"mfaSatisfied":true}).
// The catch-all /bff/** 501 from mock-steps.ts is installed first, so any call a
// scenario did not mock still fails loudly.

import { expect } from '@playwright/test';
import { Given, When, Then } from '../support/fixtures';
import { activePage } from './_registry';

const NOW = '2026-09-30T00:00:00Z';
const GIB = 1024 * 1024 * 1024;

function json(status: number, body: unknown) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** The gateway's step-up refusal: empty body, the signal and the denial header. */
function stepUpRefusal(path: string) {
  return {
    status: 403,
    headers: {
      'X-Route-Denied': `hugmesh-fe-gateway:${path}`,
      'X-Step-Up-Required': 'X-Mfa-StepUp',
    },
    body: '',
  };
}

function bodyOf(raw: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

Given('the tube-bff refuses the first ban with the gateway step-up signal and then bans any user', async () => {
  let calls = 0;
  await activePage().route('**/bff/tube/admin/access/ban', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    calls += 1;
    if (calls === 1) return route.fulfill(stepUpRefusal('/bff/tube/admin/access/ban'));
    const userSubject = String(bodyOf(route.request().postData())['userSubject']);
    return route.fulfill(
      json(200, {
        id: `acc-banned-${userSubject}`, domain: 'domain-a', userSubject, accessType: 'banned',
        state: 'active', grantedBySubject: 'google:admin@example.test', reason: null,
        createdAt: NOW, expiresAt: null, revokedAt: null,
      }),
    );
  });
});

Given(
  'the tube-bff refuses the first storage budget with the gateway step-up signal and then applies it with {int} GB used',
  async ({}, usedGb: number) => {
    let calls = 0;
    await activePage().route('**/bff/tube/admin/storage-budget', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      calls += 1;
      if (calls === 1) return route.fulfill(stepUpRefusal('/bff/tube/admin/storage-budget'));
      const body = bodyOf(route.request().postData());
      return route.fulfill(
        json(200, {
          domain: 'domain-a', userSubject: String(body['userSubject']), usedBytes: usedGb * GIB,
          budgetBytes: Number(body['budgetBytes']), updatedAt: NOW,
        }),
      );
    });
  },
);

Given('the platform BFF accepts any 6-digit second-factor code', async () => {
  await activePage().route('**/bff/mfa/challenge', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill(json(200, { mfaSatisfied: true }));
  });
});

Then('{string} sees the step-up dialog fully inside the viewport', async ({}, _username: string) => {
  const page = activePage();
  const dialog = page.locator('[data-testid="tube-stepup"]');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="tube-stepup-intro"]')).toContainText('needs a fresh security check');
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box, 'the step-up dialog has no layout box').not.toBeNull();
  expect(viewport, 'no viewport').not.toBeNull();
  // A real, usable box: wide and tall enough to hold a code field and two buttons,
  // and entirely inside the viewport (not clipped, not off-screen, not 0x0).
  expect(box!.width).toBeGreaterThan(240);
  expect(box!.height).toBeGreaterThan(120);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  // Its controls are laid out too, not just the wrapper.
  for (const id of ['tube-stepup-code', 'tube-stepup-submit', 'tube-stepup-cancel']) {
    const b = await page.locator(`[data-testid="${id}"]`).boundingBox();
    expect(b, `${id} has no layout box`).not.toBeNull();
    expect(b!.width).toBeGreaterThan(0);
    expect(b!.height).toBeGreaterThan(0);
  }
  await page.screenshot({ path: `results/shots/step-up-dialog-${Date.now()}.png`, fullPage: false });
});

When('{string} enters the step-up code {string} and verifies', async ({}, _username: string, code: string) => {
  const page = activePage();
  await page.locator('[data-testid="tube-stepup-code"]').fill(code);
  await page.locator('[data-testid="tube-stepup-submit"]').click();
});

When('{string} cancels the step-up dialog', async ({}, _username: string) => {
  await activePage().locator('[data-testid="tube-stepup-cancel"]').click();
});

Then('{string} no longer sees the step-up dialog', async ({}, _username: string) => {
  await expect(activePage().locator('[data-testid="tube-stepup"]')).toHaveCount(0);
});
