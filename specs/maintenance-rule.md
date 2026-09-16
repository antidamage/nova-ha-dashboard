# Maintenance Rule

Every project we work on must be specified, and the specification lives with
the code.

For this project the specification is the set of files under `specs/`, one per
feature area, indexed by `specs/README.md`. Any code change that alters
behaviour, APIs, configuration, persistence, deployment, tests, or
user-visible UI must revise the relevant spec in the same change. A change
that spans areas revises each one it touches.

When remembered chat history and source code disagree, the current source code
is authoritative unless the user explicitly decides otherwise.

This rule and the ones below were `SPEC.md` §2 until 2026-09-16, when the
185KB root `SPEC.md` was dissolved into `specs/` so that reading a spec costs
an agent one area rather than the whole product. Citations elsewhere in the
tree point here by path; see `specs/agent-token-footprint.md` for why.

### Golden Rule: No Machine-Specific Code

The dashboard is a **distributed product**, not a bespoke program for one
machine. This is a golden rule and it is non-negotiable: the codebase must
**never** contain code that is specific to a named machine. There must be no
branch, constant, hostname check, special case, or conditional keyed on the
production hostname, a particular IP, or any other individual machine's
identity. If
you find yourself about to write `if (host === "nova")` or the equivalent, stop
— that is always the wrong shape.

Machine-specific behaviour is expressed only through two mechanisms:

1. **Roles, not identities.** Code may branch on an *abstract role* — for
   example a `host` role (the machine that runs the dashboard and Home
   Assistant), a `kiosk` role, a `client` role, etc. Roles are capabilities and
   responsibilities, never the name of one box. Any machine that fills a role
   gets the behaviour; swapping which physical machine fills it changes nothing
   in the code.
2. **Configuration, not constants.** All machine-specific values — hostnames,
   IPs, endpoints, device IDs, deploy paths, credentials, MACs, feature toggles
   tied to one installation — live in configuration (env, `dashboard-config`,
   theme, or the config model in §5), never hard-coded in source. When a new
   machine-specific need appears, the correct fix is to add a config value and
   generalise the code to consume the abstract case, not to special-case the
   machine.

Nova (hostname: see `PRIVATEREF.md#1.1`) is described throughout this SPEC as
*the current
installation* — its identity belongs in config and deployment docs, not in
application code. The same build must run unchanged on any host that is
configured for the appropriate role. Any change that hard-codes a machine, or
that Codex/an agent proposes with a machine-specific branch, must be rejected
and re-expressed as role + config before it lands.

#### The rule covers households, not just machines

A **brand-new user must be able to deploy this dashboard against their own Home
Assistant with no code changes**, and without inheriting anyone else's devices.
So the same prohibition applies to household data: entity ids, area and room
names, device ids, MAC addresses, electricity tariffs, billing history, a
timezone, a postcode. None of it belongs in `lib/` or `app/`.

**A config read with a hard-coded fallback beside it does not satisfy this
rule.** `config.endDay || BILLING_END_DAY` and
`config.monthlyTemps[i] ?? aucklandMonthlyTempsC[i]` both leave one household's
values compiled into every install, and both let a value look configurable while
never actually being so. Generic defaults belong in the zod schema; a required
value that is missing must fail loudly rather than silently become someone
else's house.

The rule is enforced, not merely stated:

- `lib/no-household-data.test.ts` scans string literals in `lib/` and `app/` for
  entity ids, timezones, IPs, MACs and machine names. Waivers are a ratchet —
  each names the work that removes it, and a waiver matching nothing also fails,
  so the list cannot outlive the problem.
- `lib/fresh-install.test.ts` builds the dashboard against an invented home
  using only what ships in git, and asserts nothing of the maintainer's house
  appears.

Values that are genuinely specific to one home live in a **household package**
deployed separately (see `nova-household/README.md`), merged as a config layer
under `NOVA_DASHBOARD_HOUSEHOLD_CONFIG`. The dashboard must work with that
package absent; that is the property which proves the separation is real.

### Demo Dashboard Parity

The project ships a public demo/dummy-data build of the dashboard. Demo mode is
enabled with `NEXT_PUBLIC_NOVA_DEMO_MODE=true`; `lib/demo-config.ts` intercepts
`/api/*`, serves generic fixtures from `nova-dummy-data-provider`, and seeds
theme and theme-library state from `config/demo-theme.default.json` and
`config/demo-theme-library.default.json`.

Any feature added to the dashboard must also be supported by the demo dashboard,
so the demo stays a faithful, fully-featured showcase of the real product. The
only permitted exception is anything that would reveal personal data: the demo
must never expose real personal information such as actual room names, house
layout, device names, locations, account details, calendar/task content, or
usage history. Where a feature depends on such data, the demo must present a
generic, fictional stand-in (for example, generic room names and a generic house
layout) rather than dropping the feature. A new dashboard feature is not
complete until its demo equivalent exists with personal data genericised.

Demo mode runs as a static export with no server, so server-only background
services (the update scheduler and camera recorders started from
`instrumentation.ts`) are skipped when `NEXT_PUBLIC_NOVA_DEMO_MODE=true`; this
also keeps the server-backed E2E harness clean. Because the demo seeds client
state (theme, config) from `localStorage` before hydration, any element whose
SSR markup depends on that client-only state must not be gated directly on it —
gate the reveal on a post-mount flag instead, so the first client render matches
the server and React does not leave a hydration-mismatched attribute stuck (this
previously hid the `/config` theme editor in the demo).

### Experience Mode Parity

The dashboard runs in two per-device experience modes: **rich** (the default:
status orb, WebGL fluid background, live map, live camera, full CSS effects)
and **lite** (a fast pathway for older hardware, flagged as
`html[data-nova-lite]`; source of truth is
`app/components/dashboard/experienceModeSetting.ts`). See the Experience Modes
section (§31) for the full model.

Any new visual, animated, or computationally costly feature must declare its
lite behavior before it is complete. CSS animations, transitions, and backdrop
filters are neutralised automatically by the lite kill-switch block in
`app/globals.css`, so purely CSS-driven effects need no extra work beyond
checking their instant end state looks right in lite. Anything JS-driven —
requestAnimationFrame loops, canvas/WebGL rendering, polling, media playback,
heavy module loads — is **not** auto-covered and must be explicitly gated with
`useLiteMode()` / `readExperienceModeSetting()`. A feature with no acceptable
lite behavior does not ship. Follow the checklist in `docs/lite-mode.md`.

### Engineering and Architecture Standards

Future implementation work should treat the dashboard as a set of focused,
loosely coupled domains rather than a monolith. Features should be designed as
isolated modules, services, API routes, and UI surfaces with clear ownership.
Business logic, data fetching, persistence, and presentation should stay
separate. Domain logic must remain self-contained, and internal storage or Home
Assistant schema details should not leak directly into public API contracts.

Components and templates should follow single-responsibility boundaries. Reuse
standard layouts and shared primitives where they exist rather than hardcoding
new structural wrappers. Break complex components, templates, and code paths
into sub-components or helper modules to a reasonable level so layout and logic
are not duplicated excessively. Follow good architecture patterns and make
senior engineering tradeoffs: keep UI components as dumb as practical, pass
data down through props, emit events upward, and put orchestration or side
effects in the owning container, hook, server module, or route.

Abstraction should be deliberate. Prefer the rule of three: avoid premature
abstractions until a real pattern appears in three or more distinct places, but
do not leave repeated layout or behavior scattered once the pattern is clear.
Prefer composition over inheritance or deeply nested class hierarchies. Do not
create broad `utils` or `helpers` dumping grounds; shared code must be grouped
by domain or purpose, such as lighting, tasks, router metrics, preferences, or
validation.

Code should fail fast at system boundaries with explicit validation, typed
inputs, and clear error handling. External inputs from HTTP requests, config
imports, Home Assistant, iCloud, Powershop, and browser clients must be
validated or normalized before use. Keep code self-documenting with precise
names and small functions; comments should explain why a non-obvious decision
exists, not restate what the code already says.
