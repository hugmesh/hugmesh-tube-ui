/**
 * GUARD RUNNER — makes "the guard suite did not run" a RED pipeline.
 *
 * WHY THIS FILE EXISTS. `test:headers` is a BLOCKING CI job and `build:image`
 * needs it, but the command it used to run —
 *
 *     node --test "tests/**\/*.test.mjs"
 *
 * EXITS 0 WHEN THE GLOB MATCHES NOTHING. Measured twice: an empty `tests/`
 * directory exits 0, and the real CI command (`docker run … node:24-alpine sh
 * -c 'node --test "tests/**\/*.test.mjs"'`) against a checkout with
 * `tests/security-headers.test.mjs` deleted reports `# fail 0` and exits 0. So
 * deleting or renaming the one file that carries the whole nginx.conf header
 * contract turned the gate GREEN and let the image build behind a guard that
 * asserted nothing. That is the same silent-skip class the org's DAST harness
 * was fixed for: an absent scan must never be indistinguishable from a clean
 * one.
 *
 * WHAT THIS DOES INSTEAD. Discover the guard files itself (no shell glob, so
 * "no matches" is a value this program can see), refuse to continue if there
 * are none, run them, and assert the runner's OWN summary counts: at least
 * MIN_TESTS tests actually executed and none failed. Deleting the suite now
 * fails at discovery; emptying it fails at the floor; and deleting THIS file
 * fails the job outright, because the CI command names it directly and node
 * exits non-zero on a missing entry point.
 *
 * Run: `npm run test:headers`  (node --test under the hood, no dependencies).
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * The floor, deliberately a hard-coded number and not `> 0`.
 *
 * RAISE IT when you add a guard. NEVER LOWER IT to make a red pipeline green —
 * lowering it is the exact move this file exists to prevent. If a guard is
 * genuinely obsolete, delete the test AND lower the floor in the same commit,
 * with the reason in the commit message.
 */
const MIN_TESTS = 13;

const TESTS_DIR = import.meta.dirname;

const files = readdirSync(TESTS_DIR, { recursive: true })
  .filter((f) => String(f).endsWith('.test.mjs'))
  .map((f) => join(TESTS_DIR, String(f)))
  .sort();

if (files.length === 0) {
  console.error(
    `run-guards: no *.test.mjs under ${TESTS_DIR}. The header contract for nginx.conf is ` +
      `UNGUARDED — refusing to report success. (This is the failure the plain ` +
      `\`node --test "tests/**/*.test.mjs"\` command reported as a pass.)`,
  );
  process.exit(1);
}
console.log(`run-guards: ${files.length} guard file(s):\n  ${files.join('\n  ')}`);

const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
process.stdout.write(res.stdout ?? '');

if (res.error) {
  console.error(`run-guards: could not start the test runner: ${res.error.message}`);
  process.exit(1);
}

/** Read one `# <key> <n>` line out of the TAP summary. */
const count = (key) => {
  const m = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(res.stdout ?? '');
  return m ? Number(m[1]) : null;
};
const tests = count('tests');
const failed = count('fail');

if (tests === null || failed === null) {
  console.error(
    'run-guards: the TAP summary carried no `# tests` / `# fail` line, so nothing here can ' +
      'tell a clean run from a run that never happened. Failing closed.',
  );
  process.exit(1);
}
if (tests < MIN_TESTS) {
  console.error(
    `run-guards: only ${tests} test(s) ran, floor is ${MIN_TESTS}. Guards were deleted or ` +
      `skipped. If that was deliberate, lower MIN_TESTS in this file IN THE SAME COMMIT and ` +
      `say why.`,
  );
  process.exit(1);
}
if (failed > 0 || res.status !== 0) {
  console.error(`run-guards: ${failed} test(s) failed (runner exit ${res.status}).`);
  process.exit(1);
}
console.log(`run-guards: ${tests} guard(s) ran, ${failed} failed, floor ${MIN_TESTS}. OK.`);
