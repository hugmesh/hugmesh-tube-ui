import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

// Copied from the proven hugmesh.games/e2e pattern (and the merged wave-2b-1
// admin-ui harness). The tube-ui is a native-federation REMOTE the
// hugmesh.net host mounts at /tube behind route-access ROLE_TUBE, so the
// e2e baseURL points at the host front door (the federated remote is not
// browsable in isolation in a real stack). Override with E2E_BASE_URL.
//
// OFFLINE MOCK LANE: with E2E_SERVE_APP=1 the config starts the STANDALONE dev
// shell itself (`ng run tube:serve-original:development`, mounted at /tube,
// fixed port so no random-port discovery) and points baseURL at it. The
// `@mock` features then run with a seeded session + page.route() standing in
// for the tube-bff — no host shell, no Casdoor, no cluster. See README.md.
const serveApp = process.env.E2E_SERVE_APP === '1';
const APP_PORT = 4209;
const baseURL =
  process.env.E2E_BASE_URL ??
  (serveApp ? `http://localhost:${APP_PORT}` : 'https://host.docker.internal:8443');

// playwright-bdd compiles every .feature under features/ into a generated
// .spec.js (under .features-gen/), discovers them via `testDir`, and wires the
// World fixture from features/support/fixtures.ts. Step definitions live under
// features/steps/ and the hooks/World are imported once per worker via the
// `steps` glob (support/ is included so fixtures.ts — which registers the
// AfterStep screenshot hook — loads).
const bddTestDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: [
    'features/steps/**/*.ts',
    'features/support/**/*.ts',
  ],
  // Cucumber tag-expression filter. WAVE 2b ships DARK: every scenario that
  // needs a live stack (host shell + tube-bff + Casdoor seed) is tagged
  // `@cluster` at the feature level, and this filter EXCLUDES them — so the
  // DEFAULT run requires no cluster. Re-enable a feature by dropping its
  // `@cluster` tag once the env-test-build wiring lands (a later wave).
  //
  // Why `@cluster`, not playwright-bdd's reserved `@skip`: `@skip` removes a
  // scenario from GENERATION entirely (bddgen emits 0 specs for it), so a
  // skip-tagged suite can't be DISCOVERED — `playwright test --list` would
  // return 0 and we couldn't prove the Gherkin compiles. `@cluster` is a plain
  // filter tag: a no-filter `bddgen` + `playwright test --list` (see the
  // .gitlab-ci.yml e2e:bdd job) generates + lists every scenario, proving they
  // parse, while this default config keeps them dark.
  tags: 'not @cluster',
});

export default defineConfig({
  webServer: serveApp
    ? {
        command: `npx ng run tube:serve-original:development --port ${APP_PORT}`,
        cwd: '..',
        // A real route, not '/': it 200s only once the bundle is being served.
        url: `http://localhost:${APP_PORT}/tube/my`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      }
    : undefined,
  // Single-worker. Two workers cause flaky failures: per-role login through
  // Casdoor + native-federation manifest fetches contend on a small dev stack
  // and `waitForURL` after the login click stalls intermittently. Serial
  // execution keeps the cross-user / DENY isolation matrix reliable.
  fullyParallel: false,
  workers: 1,
  // One retry catches the rare login-page flake without papering over real
  // regressions — a deterministic authz bug fails twice in a row.
  retries: 1,
  timeout: 180_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'results/html', open: 'never' }],
  ],
  outputDir: 'results/artifacts',
  use: {
    baseURL,
    // The whole point — accept the self-signed cert without rejecting.
    ignoreHTTPSErrors: true,
    // Trace + video retention is forced ON for every run so the e2e artefact
    // harvest always has a per-step PNG + a full webm to fall back on. The
    // per-step PNG hook in features/support/fixtures.ts gives granular shots;
    // the video covers everything between steps (federation init, route
    // transitions, media sign + <video> load) so a reviewer can scrub the whole
    // scenario timeline.
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'on',
    // Optional: a specific chromium build (the cached one on a dev box). Unset in
    // CI, where the Playwright image ships the matching browser.
    launchOptions: { executablePath: process.env.E2E_CHROMIUM || undefined },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      // BDD project — generated specs from .feature files plus their step
      // definitions. Only meaningful after `npx bddgen` has run
      // (`npm run bdd` / `npm run bdd:gen`).
      name: 'bdd',
      testDir: bddTestDir,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
