# Testing

Three layers cover the dashboard: Vitest unit/component tests, the dedicated
aircon Node test, and a Playwright end-to-end suite that drives the demo build.

### Unit and component tests (Vitest)

Unit tests are colocated `*.test.ts(x)` files next to the code they cover, run
with Vitest under jsdom. Notable suites include:

- `lib/aircon-control.test.ts` (via the dedicated Node runner, see below).
- `lib/camera/recorder/args.test.ts`, `recorder/pause.test.ts`,
  `update-pause.test.ts` — device argument shaping and the updater pause gate.
- `lib/router-metrics.test.ts` and `lib/modules/router/module.test.ts` —
  data-rate unit normalization, rate-entity selection, and router status.
- `lib/parse-task-csv.test.ts`, `lib/preferences.test.ts`,
  `lib/powershop-usage.test.ts`, `lib/icloud-config.test.ts`,
  `lib/config-scaffold.test.ts`, `lib/system-control.test.ts` — pure
  CSV/preferences/usage/config logic.
- `lib/orb-modules.test.ts` and `app/components/avatar/orb-renderer/orbRenderer.test.ts` — orb
  module normalization and canvas rendering against a recording stub.
- `lib/dashboard-config.test.ts`, `lib/mcp-dashboard.test.ts`,
  `lib/state.golden.test.ts`, `lib/tasks/tasks.test.ts`,
  `app/components/ConfigWorkspace.test.tsx`, and the dashboard component/hook
  suites under `app/components/`.
- `app/components/dashboard/experienceModeSetting.test.tsx`,
  `app/components/ExperienceModeModal.test.tsx`, and
  `app/liteMode.contract.test.ts` — the experience-mode setting, the first-run
  chooser, and a source-level tripwire asserting the lite CSS kill-switch and
  the head-bootstrap `data-nova-lite` seed exist (§31).

Coverage is available via `npm run test:coverage` (v8 provider, report under
`coverage/`). `lib/` logic is the primary coverage target; `app/` UI behaviour is
covered mainly by the E2E suite below rather than jsdom.

### End-to-end tests (Playwright)

`e2e/*.spec.ts` exercise the dashboard in demo mode
(`NEXT_PUBLIC_NOVA_DEMO_MODE=true`), so no Home Assistant, camera, or personal
data is touched. `playwright.config.ts` starts two servers: a small CORS static
server for the `nova-dummy-data-provider` fixtures
(`e2e/fixtures/provider-server.mjs`, mirroring the cross-origin GitHub Pages
demo) and `next dev` in demo mode. `e2e/global-setup.ts` warms both routes so
parallel workers do not race first-request compilation. Specs cover dashboard
load, zone navigation, lighting, climate, tasks/reminders, the `/config`
workspace, theme, and the experience-mode first-run/lite pathway
(`e2e/experience-mode.spec.ts`). Run with `npm run test:e2e` or, from the repo
root, `./run-e2e.ps1` (which installs the Chromium build if missing).

The navigation helpers `gotoDashboard`/`gotoConfig` pre-seed
`nova.dashboard.experienceMode.v1 = "rich"` via an init script so the
first-run chooser never blocks unrelated specs; tests exercising the chooser
itself navigate manually from a fresh context.

### Test configuration

- `vitest.config.ts` for unit/component tests and coverage.
- `test/setup.ts` for test environment setup.
- `tsconfig.aircon-test.json` for the dedicated aircon test compile.
- `playwright.config.ts` and `run-e2e.ps1` for the end-to-end suite.

Expected verification before behavior changes:

- Run `npm run test:unit` for ordinary unit/component changes.
- Run `npm run test:aircon` for any aircon planner, climate control, or
  dashboard auto change.
- Run `npm run test:e2e` for changes to dashboard UI, navigation, `/config`, or
  the demo bootstrap.
- Run `npm run package:skills` when MCP/agent skill files or public metadata
  change.
- Run `npm test` before release/deployment-level changes when practical.

Hardware-power control guardrail:

- Never test the managed-computer sleep or wake buttons (or their `/api/desktop/
  sleep` and `/api/desktop/wake` APIs) against a real machine during
  verification. Do not press, click, automate, curl with credentials, or
  otherwise invoke those controls. The user tests sleep/wake manually. Agents may
  verify only non-mutating structure such as build output, route presence, layout
  order, and unauthenticated negative checks.

Managed-computer sleep and wake:

- Sleep is over SSH (`sleepManagedComputer`, gated on `capabilities.sleep`);
  waking a sleeping machine is Wake-on-LAN (`wakeManagedComputer` →
  `buildWakeOnLanPacket` broadcast on UDP 9/7), gated on `capabilities.wake` plus
  a configured `macAddress`. Nova is never sleepable or wakeable. The network
  zone shows construction-box Sleep/Wake buttons (same scheme as `/config`
  System Power) with a single body-portal confirmation per action.

Aircon change checklist from `docs/aircon-auto.md`:

- Update or add a focused test before changing planner behavior.
- Preserve the dashboard auto delta invariant.
- Run `npm run test:aircon`.
- Build the app.
- Verify heat/cool payloads include matching `set_hvac_mode` and
  `set_temperature` actions.
