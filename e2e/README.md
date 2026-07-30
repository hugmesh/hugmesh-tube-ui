# hugmesh-tube-ui — e2e (Playwright + playwright-bdd)

Gherkin-driven end-to-end harness for the **tube-ui** federated remote
(LocalTube — the optional, feature-gated tube service UI), copied from the
proven `hugmesh.games/e2e` pattern (`@playwright/test` + `playwright-bdd`,
single-worker serial, `screenshot:'on'`/`video:'on'`, HTML reporter, the
per-step PNG `AfterStep` hook in `features/support/fixtures.ts`) and mirrored on
the merged wave-2b-1 admin-ui harness.

LocalTube lets a Google-logged-in user view their **own subscribed-channel
content**: the host mounts `/tube` behind route-access `ROLE_TUBE`, then the
in-remote child guards enforce the per-view tier — a granted `ROLE_TUBE` user
sees only **My Tube**, while an admin/superadmin additionally sees **Tube
Access** + **Storage Budgets**. Use is **default-deny**: `ROLE_TUBE` is the
floor, but the BFF `TubeAccessGuard` enforces an active `tube_access` grant at
request time, so a granted-role-but-ungranted-use user gets a graceful
"access not yet granted" panel.

| Class | Feature file | What it asserts |
| --- | --- | --- |
| USER-SITUATIONAL | `features/tube/my-tube.feature` | My Tube: own subs/queue/usage, play own download (ALLOW); enqueue **disabled + budget-full helptext**; default-deny access panel; plain user → `/tube/forbidden` |
| USER-SITUATIONAL | `features/tube/admin-consoles.feature` | grant/ban + storage-budget consoles gated to admin/superadmin; ban-precedence note; superadmin-only manage-all panel; granted user bounced (DENY) |
| FEATURE-GATED | `features/tube/feature-gating.feature` | optional-service / role-absent gating — reach the remote only with the Tube role, else the boundary screen |
| MULTIUSER | `features/multiuser/grant-then-use.feature` | admin grants → user can use; admin bans → user re-denied (ban > grant), both identities live |
| CROSS-USER | `features/cross-user/isolation.feature` | granted user DENIED the admin consoles + admin/superadmin BFF endpoints (403); the **media-sign owner wall** (can't sign another user's contentPath, 403); anonymous → 401 |
| A11Y | `features/a11y/accessibility.feature` | skip-link → focus `#tube-main`, named menubar landmark, roving tabindex, `aria-current` active item, labelled `role="progressbar"` usage bar, announced status, focus restore |

## Ships dark (wave 2b)

Every scenario that needs a live stack (host shell serving the remote +
tube-bff + Casdoor seed) is tagged **`@cluster`** at the feature level. The
default config filters them out (`tags: 'not @cluster'`), so the default run
needs **no cluster** and the GitLab `e2e:bdd` job is `allow_failure: true`.

`@cluster` is used deliberately instead of playwright-bdd's reserved `@skip`:
`@skip` drops a scenario from generation entirely (`bddgen` emits 0 specs for
it), so a `@skip`-tagged suite cannot be *discovered*. `@cluster` is a plain
filter tag — the no-filter validation below generates and lists every scenario,
proving the Gherkin compiles, while the default config keeps them dark.

This is **pure test code** in a new `e2e/` dir — it does not touch the karma
unit build (`npm test` at the repo root) or any app code.

## Offline validation (no cluster)

```sh
cd e2e
npm install
npx bddgen            # default: 'not @cluster' → 0 specs (ships dark, intended)

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
omits the `not @cluster` filter), export `E2E_BASE_URL` + the per-role
`E2E_*_PASSWORD` vars, then `npm run bdd`.
