# Architecture

Where code lives. For what it *does*, see [`specs/README.md`](specs/README.md).

This file exists so an agent can find the right file without reading the tree.
If you are about to `grep -r` across the repo, read this first.

## The shape

A Next.js App Router application that talks to Home Assistant, plus three
Python services that are deployed separately.

```
app/          Next.js routes, API handlers and React components
lib/          Server and shared logic. The largest area.
config/       Default configuration, layered at runtime
specs/        The specification, one file per feature area
docs/         Guides and worked examples, not normative
ops/          Deployment, kiosk, Caddy, Home Assistant packages
scripts/      Build, packaging and maintenance scripts
test/         Fixtures. Unit tests are colocated with their source.
e2e/          Playwright suites
face-auth/         Python service — face-released passkey auth
camera-events/     Python service — camera event processing
```

## Finding things

| Symptom | Look in |
|---|---|
| An HTTP route misbehaves | `app/api/<route>/route.ts` — route-per-directory throughout |
| A control renders wrong | `app/components/` (see below) |
| A device won't respond | `lib/ha.ts` and `lib/ha/` |
| Lighting, zones, presets | `lib/ha/`, `app/components/dashboard/ZoneControls.tsx` |
| Aircon or heater | `lib/aircon-control.ts`, `lib/climate-control.ts`, `app/components/dashboard/climateCommands.ts` |
| Power figures | `lib/power/` (`store.ts` owns the state) |
| Theme, accent, colour | `app/components/accentColor.ts`, `app/components/AccentConfig.tsx` |
| Visualiser | `lib/phonoscope*.ts` + `lib/phonoscope*/`, `app/components/phonoscope/` |
| Status orbs | `lib/orb-modules/`, `lib/orb-info/`, `app/components/orb-info/` |
| Tasks and reminders | `lib/tasks.ts`, `app/components/tasks/`, `app/components/reminders/` |
| Camera | `lib/camera/`, `app/components/dashboard/CameraPanel.tsx`, `camera-events/` |
| Login or face auth | `app/components/auth/`, `app/components/face/`, `face-auth/` |
| Styling | `app/globals.css` — see the warning below |
| Config schema or validation | `lib/config-schema/`, `app/api/config/` |
| A shared type (`DashboardState`, preferences, HA entities) | `lib/types/`, by domain; import from `lib/types.ts` |
| Realtime events / SSE | `lib/dashboard-events/` (`store.ts` owns the state) |
| The module system | `lib/modules/`, `app/components/modules/` |

## `lib/`

Server and shared logic. Packages that already follow the convention:

- **`lib/ha/`** — the Home Assistant client, split into `client`, `entities`,
  `zones`, `registry`, `twins`, `health`, `states`. `lib/ha.ts` is the facade
  over it. **This is the reference example** for how a package should look.
- **`lib/orb-info/`** — the file-role vocabulary already applied: `types.ts`,
  `format.ts`, `catalogue.ts`, `stack.ts`, `preferences.ts`, `events.ts`.
- `lib/camera/`, `lib/modules/`, `lib/api/`, `lib/desktop-theme-actions/`,
  `lib/mcp/`.

Everything else at `lib/` top level is flat and being migrated package by
package. See `specs/agent-token-footprint.md` §14 for the phase order.

## `app/components/`

Existing areas: `auth/`, `dashboard/`, `face/`, `modules/`, `orb-info/`,
`phonoscope/`, `reminders/`, `tasks/`. `dashboard/` is the largest and holds
the panels and cards.

The reusable control inventory is in [`CLAUDE.md`](CLAUDE.md), not here —
**read it before building any new control.** The rule is that a surface with
an existing custom component for a control reuses it rather than dropping to a
raw `<input>` or an unstyled `<button>`.

## Conventions

- **Path alias** `@/*` maps to the repo root. Deep relative imports are
  common but the alias is available.
- **`isolatedModules: true`** — re-exported types need `export type { … }`.
- **Facades, not barrels.** A package keeps a thin re-export file at the
  original path (`lib/power.ts` over `lib/power/`) so call sites never change.
  Do not add `index.ts` barrels.
- **File-role vocabulary** inside a package: `types.ts`, `constants.ts`,
  `schema.ts`, `<noun>-model.ts`, `store.ts`, `client.ts`, `<verb>.ts`,
  `events.ts`, `use<Thing>.ts`, `<Component>.tsx`. That order is also the
  allowed dependency direction.
- **10 KB soft cap per source file**, enforced by `lib/architecture.test.ts`
  with a burn-down allowlist. `node scripts/check-file-sizes.mjs` reports the
  current state.
- **Tests are colocated** with their source and collected by glob.

Full detail: [`specs/agent-token-footprint.md`](specs/agent-token-footprint.md).

## Traps

Things that will bite an agent that does not know them:

- **`app/globals.css` is 247KB with a BOM at byte 0 and no `@layer`
  discipline.** Source order is load-bearing — reordering changes which rule
  wins. Five contract tests read it as text and regex it.
- **`lib/no-household-data.test.ts` waives by file path**, and a waiver that
  matches nothing also fails. Moving a waived file breaks it in both
  directions. Grep the waiver list before moving anything under `lib/` or
  `app/`.
- **`lib/power/store.ts` keeps state on `globalThis`** because Next.js can
  instantiate a module more than once. Two copies of that state means two
  power histories, silently.
- **`test:aircon` compiles separately** via `tsconfig.aircon-test.json` and
  runs `node --test` against a hard-coded path under `.tmp/aircon-tests/`.
- **194 files carry `"use client"`.** Extracting a helper without the
  directive, or pulling `fs`/`ssh2` into a client graph, fails at build time
  if you are lucky and at runtime if you are not.
- **19 config sections load via `next/dynamic`** by literal path in
  `app/components/ConfigWorkspace.tsx`. A facade that eagerly re-exports them
  collapses that code-splitting without failing anything.
- **No machine-specific code.** Entity IDs, hostnames, IPs, timezones and
  tariffs live in config, never in source. This is a golden rule; see
  [`specs/maintenance-rule.md`](specs/maintenance-rule.md).

## Commands

```bash
npm run dev                      # dev server
npm run build                    # production build — the only check that
                                 # models the server/client boundary
npm test                         # unit + aircon + skills packaging
npm run test:unit                # vitest
npm run test:e2e                 # playwright
npx tsc --noEmit                 # type check
node scripts/check-file-sizes.mjs # file size report
```

Deployment goes through `deploy-nova-stack.ps1` at the parent repo root, from
PowerShell. See [`specs/deployment-and-operations.md`](specs/deployment-and-operations.md).
