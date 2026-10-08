# hugmesh-tube-ui — e2e (Playwright + playwright-bdd)

Gherkin end-to-end tests for the **tube-ui** federated remote (LocalTube, the
optional, feature-gated tube service UI). The harness copies the proven
`hugmesh.games/e2e` pattern (`@playwright/test` + `playwright-bdd`, one serial
worker, `screenshot:'on'`/`video:'on'`, HTML reporter, the per-step PNG
`AfterStep` hook in `features/support/fixtures.ts`) and mirrors the merged
wave-2b-1 admin-ui harness.

LocalTube lets a Google-logged-in user view the content of their **own
subscribed channels**. The host mounts `/tube` behind route-access `ROLE_TUBE`.
Child guards in the remote then set the view. A granted `ROLE_TUBE` user sees only
**My Tube**. An admin or superadmin also sees **Tube Access** and **Storage
Budgets**. Use is **default-deny**: `ROLE_TUBE` is the floor, but the BFF
`TubeAccessGuard` requires an active `tube_access` grant at request time. A user
with the role and no grant gets an "access not yet granted" panel.

| Class | Feature file | What it asserts |
| --- | --- | --- |
| USER-SITUATIONAL | `features/tube/my-tube.feature` | My Tube: own subs/queue/usage, play own download (ALLOW); enqueue **disabled + budget-full helptext**; default-deny access panel; plain user → `/tube/forbidden` |
| USER-SITUATIONAL | `features/tube/admin-consoles.feature` | grant/ban + storage-budget consoles gated to admin/superadmin; ban-precedence note; superadmin-only manage-all panel; granted user bounced (DENY) |
| USER-SITUATIONAL | `features/tube/media-player-failure.feature` | a 403 from the media-sign endpoint shows an error and a retry, never a `<video>` |
| USER-PREFERENCE | `features/tube/google-connect.feature` | Google account panel: degraded status, connect, reauth-required, no-consent-URL disclosure, full-page navigation, disconnect, sync |
| FEATURE-GATED | `features/tube/feature-gating.feature` | optional-service / role-absent gating: reach the remote with the Tube role, else the boundary screen |
| MULTIUSER | `features/multiuser/grant-then-use.feature` | admin grants → user can use; admin bans → user re-denied (ban > grant); both identities live |
| MULTIUSER | `features/multiuser/restore-and-remove.feature` | restoring a ban re-admits the user to My Tube; removing a grant drops them to the access-not-granted panel |
| MULTIUSER | `features/multiuser/timeout-then-autorestore.feature` | a timeout denies the user for its window; a short timeout auto-restores access on expiry |
| MULTIUSER | `features/multiuser/budget-raise-unblocks.feature` | a user capped at zero is unblocked once the admin raises the budget |
| MULTIUSER | `features/multiuser/superadmin-audit-trail.feature` | an admin grant appears in the superadmin active list and history |
| CROSS-USER | `features/cross-user/isolation.feature` | granted user DENIED the admin consoles + admin/superadmin BFF endpoints (403); domain admin DENIED the superadmin endpoint (403); the **media-sign owner wall** (can't sign another user's contentPath, 403); anonymous → 401 |
| CROSS-USER | `features/cross-user/list-isolation.feature` | the owner wall again, against a real contentPath the first user created |
| A11Y | `features/a11y/accessibility.feature` | skip-link → focus `#tube-main`, named menubar landmark, roving tabindex, `aria-current` active item, labelled `role="progressbar"` usage bar, announced status, focus restore |
| USER-SITUATIONAL (`@mock`) | `features/mock/tube-access.feature`, `features/mock/storage-budgets.feature` | what the Tube Access and Storage Budgets consoles send and render against a mocked BFF (see *Offline mocked-backend lane*) |

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell serving the remote, tube-bff,
Casdoor seed) is tagged **`@cluster`** at the feature level. That is 47
scenarios. The default config filters them out (`tags: 'not @cluster'`), so the
default run needs **no cluster**, and the GitLab `e2e:bdd` job is
`allow_failure: true`. The 16 `@mock` scenarios are not `@cluster`, so the
default `bddgen` does generate them.

The tag is `@cluster`, not playwright-bdd's reserved `@skip`. `@skip` drops a
scenario from generation, so `bddgen` emits no spec for it and the suite cannot
be *discovered*. `@cluster` is a plain filter tag. The no-filter run below
generates and lists every scenario, which proves the Gherkin compiles, while the
default config keeps the live ones dark.

This is test code in `e2e/`. It does not touch the karma unit build (`npm test`
at the repo root) or any app code.

## Offline validation (no cluster)

```sh
cd e2e
npm install
npx bddgen            # default: 'not @cluster' → only the @mock specs (the @cluster ones stay dark)

# Prove every feature compiles + all scenarios are discovered (no filter):
cat > pw-validate.config.ts <<'EOF'
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
const d = defineBddConfig({ features: 'features/**/*.feature',
  steps: ['features/steps/**/*.ts', 'features/support/**/*.ts'] });
export default defineConfig({ reporter: [['list']],
  use: { ignoreHTTPSErrors: true, screenshot: 'on', video: 'on' },
  projects: [{ name: 'bdd', testDir: d, use: { ...devices['Desktop Chrome'] } }] });
EOF
npx bddgen -c pw-validate.config.ts
npx playwright test --list -c pw-validate.config.ts
rm pw-validate.config.ts
```

## Running against a live stack (later wave)

Drop the `@cluster` tag from a feature (or run with an override config that
omits the `not @cluster` filter). Export `E2E_BASE_URL` (default
`https://host.docker.internal:8443`) and the per-role `E2E_*_PASSWORD` vars
(`E2E_SUPERADMIN_PASSWORD`, `E2E_ADMIN_PASSWORD`, `E2E_TUBE_USER_PASSWORD`,
`E2E_TUBE_USER2_PASSWORD`, `E2E_TUBE_UNGRANTED_PASSWORD`, `E2E_USER_PASSWORD`).
Then run `npm run bdd`.

The password variables are optional overrides, not requirements. So is the shared
`E2E_PASSWORD`. When neither is set, `passwordFor()` in `tests/helpers/roles.ts`
reads the run-state `.e2e-credentials` file
written by hugmesh-generator's `make stack-seed` (`$E2E_CREDENTIALS_FILE`, or a
`.e2e-credentials` found by walking up from the working directory). There is no
built-in literal password. If nothing resolves, the suite throws and names
`make stack-seed`, rather than log in with a guessable default.

## Offline mocked-backend lane (`@mock`)

`npm run test:mock` (in `e2e/`) serves the standalone dev shell itself.
`E2E_SERVE_APP=1` makes `playwright.config.ts` start
`ng run tube:serve-original:development` on port 4209, mounted at `/tube`. It then
runs the `@mock` features: the Tube Access and Storage Budgets consoles, with a
seeded `hug.session` and `page.route()` standing in for the tube-bff. Any `/bff/`
call a scenario did not mock answers 501. Set `E2E_CHROMIUM` to use a specific
chromium build. `npm run typecheck` runs `tsc --noEmit` over the harness
(`strict` is on in `e2e/tsconfig.json`).

This proves what the consoles send and render. It does not prove that the BFF
authorises; the `@cluster` features keep that. CI job `e2e:mock` runs it
(non-blocking, `allow_failure`). Making it a required gate is a GitLab-side
project setting.
