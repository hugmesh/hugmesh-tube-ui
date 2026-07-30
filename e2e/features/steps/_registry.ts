// Shared per-scenario state. playwright-bdd recreates the test instance for
// each scenario so we reset these maps in the After() hook in
// features/support/fixtures.ts. Keys are usernames so steps can reference a user
// by name without threading a token/page through.

import { BrowserContext, Page } from '@playwright/test';

export const pageRegistry = new Map<string, Page>();
export const ctxRegistry = new Map<string, BrowserContext>();

/** The user whose page the "current" a11y/announce steps operate on. Session +
 *  navigation steps set this to the resolved username so steps whose Gherkin
 *  text carries no `{string}` (e.g. "activating the skip link moves focus to the
 *  main region") still resolve to a page WITHOUT declaring a phantom capture
 *  parameter. Cleared on scenario teardown. */
export const activeUser = { name: '' };

/** Resolve the page for the active user, or throw with a clear hint. */
export function activePage(): Page {
  const page = pageRegistry.get(activeUser.name);
  if (!page) {
    throw new Error(
      `No active page — a session/navigation step must set the active user first (activeUser="${activeUser.name}").`,
    );
  }
  return page;
}

/** Last HTTP status code captured by an API-style step (the cross-user DENY +
 *  default-deny use assertions read this). Module-global instead of test-info
 *  attached so the assertion step doesn't need to thread the World through.
 *  Cleared on scenario teardown. */
export const responseState = { lastStatus: 0 };

/** A value captured off one user's OWN data (a real contentPath read from their
 *  owner-scoped queue) so a SECOND user can then attempt to act on it — the
 *  victim-creates-first primitive for the media-sign owner wall (no hard-coded
 *  cross-user path). Cleared on scenario teardown. */
export const capturedState = { contentPath: '' };

export function resetRegistry(): void {
  pageRegistry.clear();
  ctxRegistry.clear();
  responseState.lastStatus = 0;
  activeUser.name = '';
  capturedState.contentPath = '';
}
