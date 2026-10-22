/**
 * GUARD TEST: SECURITY.md, the repository's own vulnerability-reporting policy.
 *
 * WHY. GitHub only shows the org-wide default policy from the `.github` repository
 * when that repository is public. Without a SECURITY.md here, a public copy of this
 * repo gives a researcher no private route to report a vulnerability, so the first
 * report arrives as a public issue. These checks keep the file present and keep it
 * pointing at a private channel.
 *
 * Run: `npm run test:headers` (node --test, no dependencies).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const POLICY = join(import.meta.dirname, '..', 'SECURITY.md');

test('SECURITY.md exists at the repository root and is not a stub', () => {
  assert.ok(existsSync(POLICY), `missing ${POLICY}`);
  const text = readFileSync(POLICY, 'utf8');
  assert.match(text, /^# Security Policy$/m);
  assert.ok(text.length > 400, `SECURITY.md is only ${text.length} bytes`);
});

test('SECURITY.md sends reporters to a private channel, not a public issue', () => {
  const text = readFileSync(POLICY, 'utf8');
  assert.match(text, /private vulnerability reporting/i);
  assert.match(text, /Report a vulnerability/);
  assert.match(text, /Do \*\*not\*\* open a public issue/);
});

test('SECURITY.md publishes no personal e-mail address', () => {
  const text = readFileSync(POLICY, 'utf8');
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});
