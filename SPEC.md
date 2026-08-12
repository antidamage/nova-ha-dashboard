# Nova HA Dashboard Specification

Last audited: 2026-06-22

## 1. Purpose

Nova HA Dashboard is a local-first Next.js control surface for the Nova Home
Assistant installation. It is designed for a wall, tablet, desktop, and touch
dashboard experience that controls and observes:

- Home Assistant lights, illumination switches, general switches, climate
  devices, fans, covers, humidifiers, and selected sensors.
- Room and whole-home lighting scenes, brightness, and color.
- Dashboard-managed climate behavior for lounge air conditioning and panel
  heaters.
- Weather, sun state, rain radar, and a cyber-styled local map.
- Router/network throughput.
- Electricity usage, cost estimates, Powershop account history, and modeled
  base loads.
- Local tasks, iCloud Calendar events, iCloud Reminders, alerts, and audio.
- A live outside CCTV feed with a rolling two-hour DVR and retained synthetic
  signal-test fallback.
- Runtime configuration, theme editing, MCP/agent access, and setup status.
- Nova host load visualization through the animated Nova avatar, including a
  GymMaster-backed gym visit age counter.

The dashboard is intended to run on the Nova host, with the
application deployed under `/opt/nova-ha-dashboard` and served by the
`nova-ha-dashboard.service` systemd unit. Nova is the sole dashboard and Home
Assistant host (hostname/address/user: see `PRIVATEREF.md#1.1` and `#2.1`);
Iridium is a
separate offline machine and must not be treated as a Nova alias or fallback.
Home Assistant runs locally in a container on port `8123`.

## 2. Maintenance Rule

Every project we work on must have a `SPEC.md` file.

For this project, `SPEC.md` is the canonical behavior specification for the
current codebase. Any future code change that alters behavior, APIs,
configuration, persistence, deployment, tests, or user-visible UI must revise
this file in the same change. When remembered chat history and source code
disagree, the current source code is authoritative unless the user explicitly
decides otherwise.

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

## 3. Runtime Stack

- Framework: Next.js App Router, React, TypeScript.
- Styling: CSS modules/global CSS plus runtime CSS variables for device theme.
- UI dependencies: `lucide-react`, Radix Slider and Tooltip.
- Map: `maplibre-gl`.
- Image processing: `sharp` for radar and satellite tile processing.
- Calendar/reminders: `tsdav` and `ical.js`.
- Realtime: server-sent events from `/api/events`.
- Tests: Vitest, Testing Library, jsdom, and a dedicated Node TypeScript
  aircon test runner.
- Package manager: npm with `package-lock.json`.

Project scripts:

- `npm run dev`: start Next dev server on `0.0.0.0`.
- `npm run build`: production Next build.
- `npm run start`: production Next server.
- `npm run package:skills`: validate and publish agent skill assets under
  `public/agent`.
- `npm run test:unit`: Vitest suite.
- `npm run test:coverage`: Vitest suite with v8 coverage (report under
  `coverage/`).
- `npm run test:aircon`: compile and run the aircon control test file through
  the dedicated TypeScript project.
- `npm run test:e2e`: Playwright end-to-end suite against the demo build
  (also runnable from the repo root via `./run-e2e.ps1`).
- `npm test`: unit tests, aircon tests, and skill packaging.

## 4. Environment

The default environment template is `.env.example`.

Required or primary variables:

- `HA_URL`: Home Assistant base URL. Defaults in code to
  `http://127.0.0.1:8123`.
- `HA_TOKEN`: Home Assistant long-lived access token. Required for HA API
  calls.
- `NOVA_DASHBOARD_CONFIG`: optional runtime config path. Defaults to
  `data/dashboard-config.json`.
- `NOVA_DASHBOARD_MCP_TOKEN`: bearer token required when MCP auth is enabled.
- `NEXT_PUBLIC_MAP_CENTER`: optional `lat,lng` map center compatibility
  override.

iCloud variables:

- `ICLOUD_USERNAME`
- `ICLOUD_APP_PASSWORD`
- `ICLOUD_CALENDARS`
- `ICLOUD_REMINDERS`
- `ICLOUD_SYNC_DAYS`

Powershop variables:

- `POWERSHOP_EMAIL`
- `POWERSHOP_PASSWORD`
- `POWERSHOP_DATA_DIR`

GymMaster variables:

- `GYMMASTER_EMAIL`: AllFit/GymMaster member portal login email.
- `GYMMASTER_PASSWORD`: AllFit/GymMaster member portal password.
- `GYMMASTER_DATA_DIR`: optional GymMaster scrape data directory.
- `GYMMASTER_DASHBOARD_URL`: optional dashboard origin for the scraper to
  update `/api/watchface`. The direct Node script defaults to
  `http://127.0.0.1:3000`; the production runner sets a Nova-specific default.
- `GYMMASTER_PORTAL_URL`: optional visit-history URL override, defaulting to
  the AllFit GymMaster visit history page.

Additional runtime paths used by code:

- `NOVA_DASHBOARD_PREFERENCES`: optional preferences file path.
- `NOVA_DASHBOARD_TASKS`: optional tasks file path.
- `NOVA_DASHBOARD_POWER_DATA`: optional power data directory.
- `NOVA_DASHBOARD_POWERSHOP_DATA`: optional Powershop usage data directory.
- `NOVA_DASHBOARD_BUILD_ID`: build ID fallback when `.next/BUILD_ID` is absent.

## 5. Configuration Model

The checked-in default configuration is assembled from
`config/dashboard-config.default.json`, setup-oriented `config/common.json`, and
task setup `config/tasks.json`. Runtime configuration is merged over those
defaults and validated by `lib/config-schema.ts`.

`config/orb-modules/` holds hot-droppable status orb module JSON files served
by `GET /api/orb-modules` (see Status Orb Modules); these are standalone
documents outside the merged dashboard config and its schema.

Configuration is JSON and uses `schemaVersion: 1`.

Main configuration areas:

- `homeAssistant`: domains, entity patterns, excluded entities, weather/sun
  entities, router sensors, dashboard sensor IDs, Nova assist satellite, and
  zone naming rules.
- `dashboard`: special zone IDs, command-hold timings, event poll timings,
  weather refresh timing, adaptive lighting polling, avatar widget settings,
  climate settings, and build reload outage behavior.
- `mapWeather`: map center, RainViewer manifest/fallback URLs, radar refresh
  and preload settings, and satellite tile URL template.
- `power`: timezone, billing cycle dates, sampling/publish intervals, Powershop
  rate URLs, and modeled base load definitions.
- `tasks`: iCloud sync settings, alert audio file, max upload size, alert
  window, and repeat interval.
- `theme`: default theme scope and shared theme poll interval.
- `mcp`: enabled state, bearer auth requirement, allowed origins, mutation
  permissions, and confirmation requirement.

`lib/dashboard-config.ts` responsibilities:

- Read the default, common, and tasks config files synchronously or
  asynchronously.
- Read runtime config if present.
- Apply compatibility overrides from environment where supported.
- Deep-merge runtime config over defaults.
- Validate with Zod.
- Export JSON schema from the Zod schema.
- Dry-run config imports.
- Write runtime config atomically, with queued writes to avoid concurrent file
  corruption.
- Return setup status for secrets.
- Redact config for export. Current config contains no secrets, so redaction is
  currently a pass-through.

Configuration UI:

- `/config` renders a config workspace.
- It displays current config JSON.
- It can refresh, export, validate, import, and download/view schema.
- It shows setup status for HA URL/token, iCloud username/password, Powershop
  email/password, and MCP bearer token.

## 6. Persistence

The app stores mutable local state in JSON files under `data/` by default.

- `data/dashboard-config.json`: runtime config overrides.
- `data/dashboard-preferences.json`: dashboard preferences, remembered device
  settings, theme, and adaptive lighting state.
- `data/dashboard-tasks.json`: local tasks plus mirrored iCloud task records.
- `data/power/state.json`: integrated power monitor state.
- `data/power/device-ratings.json`: optional device wattage overrides.
- `data/power/account-usage.json`: optional account usage overrides.
- `data/power/powershop/*.json`: Powershop daily scrape outputs.
- `data/gymmaster/latest.json`: latest GymMaster attendance scrape status,
  selected visit timestamp, and non-secret extraction evidence.

Preference writes and task writes are queued and atomic.

`lib/preferences.ts` stores:

- Aircon preferences such as mode, target temperature, fan speed, quiet/turbo,
  fresh air, auto mode, and the off timer.
- Panel heater preferences such as the off timer.
- Lighting preferences, including adaptive candlelight zone state and last sun
  state.
- Shared theme preferences.
- Watchface preferences. `watchface.gymLastResetAt` is retained for API and
  watchface compatibility, but now represents the latest scraped GymMaster gym
  visit timestamp rather than a user tap/reset timestamp.

## 7. Home Assistant Integration

`lib/ha.ts` owns Home Assistant REST and WebSocket interaction.

REST behavior:

- `haRest` calls the HA REST API using `HA_URL` and `HA_TOKEN`.
- `callService` calls Home Assistant service endpoints.
- Missing `HA_TOKEN` raises a setup/runtime error for calls that require HA.

WebSocket behavior:

- `haWs` connects to the HA WebSocket API.
- Registry reads use HA WebSocket APIs for areas, devices, and entities.
- `subscribeHaStateChanges` listens for HA state change events and informs the
  dashboard event poller.

Dashboard entity discovery:

- Allowed domains are configured in `homeAssistant.controlDomains`.
- Hidden, disabled, and restored unavailable entities are filtered out, except
  configured dashboard sensor IDs required by the UI.
- Entity names come from registry metadata where possible, falling back to HA
  friendly names.
- Area assignment comes from entity registry first, then device registry, then
  an unassigned area.
- Dashboard zones are built from Home Assistant areas that contain dashboard
  entities.
- Unknown area IDs are retained instead of dropped.
- A network zone is ensured even if it is absent from HA registry data.
- The Home/Everything zone is prepended and includes inside controllable
  entities except configured exclusions, climate areas, network areas, and
  special outside exclusions.

Special entity classification:

- Switches whose names or IDs match configured illumination terms such as
  light, lamp, LED, strip, neon, glow, fairy, sign, or illumination are promoted
  into the lighting layer. Switches can also be promoted explicitly by the
  `nova_illumination` label or `homeAssistant.classification.forceIlluminationEntityIds`,
  which is how an outlet/switch (e.g. neon on a smart plug) is mapped in as a
  light (see Config-driven fixture policy in §12).
- Support switches such as auto-update switches are excluded using the
  configured support switch pattern.
- Outside lighting is intentionally excluded from broad inside/everything zone
  actions via `homeAssistant.everythingExcludedEntityIds`; every live
  outside-light entity id must be listed there (see §12).
- The old top-level Devices dashboard section was intentionally removed.

Router state:

- Router download/upload sensors are selected by configured preferred IDs or
  legacy sensor names.
- Units are normalized to MB/s.
- Router reads use a short cache so the router panel can poll quickly without
  hammering HA.

Weather and sun:

- Weather reads use the configured `weather.*` entity.
- Daily forecast data is fetched through HA `weather.get_forecasts`.
- Forecast results are cached for approximately 35 minutes.
- The dashboard derives conditions, temperature, min/max, rain chance, wind,
  UV, humidity, and feels-like data where available.
- Sun state comes from the configured `sun.sun` entity.

## 8. Dashboard State

`buildDashboardState` returns the primary dashboard snapshot:

- `generatedAt`
- zones and entities
- warnings
- router metrics
- weather
- sun
- preferences

Warnings are produced when important dashboard categories are missing or
registry reads fail.

The API route `/api/state` returns this state, publishes it to connected SSE
clients, and includes build/event metadata.

## 9. Realtime Events

`lib/dashboard-events.ts` owns server-side event fanout and background timers.

Primary SSE endpoint:

- `/api/events`

Events include:

- `client-id`
- `build`
- `reload`
- `state`
- `dashboard-error`
- `tasks`
- `task-alert`
- `task-dismiss`
- `task-audio`
- keepalive comments

When a dashboard client connects:

- The server sends retry timing.
- The server assigns a client ID.
- The server sends current build metadata.
- The server sends cached dashboard state if available.
- The server sends the current task snapshot.
- The server sends current task-audio status.
- The server starts shared pollers if not already running.

Pollers and subscriptions:

- Dashboard state poll.
- HA state-change WebSocket subscription.
- Build ID poll.
- Weather refresh.
- Task alert tick.
- iCloud sync.
- Adaptive candlelight transition poll.
- Heartbeat/keepalive.

Pollers stop when there are no dashboard or task clients.

State publish rules:

- State events are deduplicated by signature, excluding generated timestamps.
- Light command holds temporarily prevent HA polling from overwriting
  optimistic light UI state.
- Remembered spectrum cursor data is retained per zone.
- HA state changes for relevant domains trigger debounced state refresh.
- Build ID changes emit `reload`.
- If the page has been unable to refresh state for the configured outage
  duration while visible, the client reloads.

## 10. UI Shell

`app/layout.tsx` defines the base document:

- Metadata title is `Nova Control`.
- Metadata declares Apple touch icon links for 57x57, 60x60, 72x72, 76x76,
  114x114, 120x120, 144x144, 152x152, 167x167, and 180x180 PNG assets, plus
  the default `/apple-touch-icon.png`. These assets are generated from
  `D:\Projects\Agent\nova-appletv-dashboard\apple-tv-icon.png` using a
  centered square crop and resized per output size.
- Global CSS is loaded.
- `NovaAvatar` is mounted at the body level.
- Inline script prevents context menus.
- Inline script hydrates device theme before React renders by reading
  localStorage, cookies, or shared theme.
- CSS variables are set for accent, highlight, background, border, map, radar,
  reminder glow, title tone, and satellite state.
- Theme cookies preserve config scope and theme values.

`app/page.tsx` renders the dynamic dashboard.

`app/components/Dashboard.tsx`:

- Reads dashboard state through `useDashboardState`.
- Uses `useDeviceTheme`.
- Uses build reload metadata.
- Restores selected zone from localStorage.
- Runs the auto-fullscreen watchdog when the per-device fullscreen setting
  enables it.
- Builds a navigation tree for Home/Everything, indoor rooms, climate, outside,
  network, Grid, and Reminders.
- Shows `TasksPanel` when the Reminders zone is selected.
- Shows `ZoneControls` for all other zones.
- Shows warnings and transient toast feedback.
- Provides a top-right `Config` link to `/config` without moving the Nova
  avatar.
- The clock panel shows Auckland time and date only; the date is intentionally
  large and no secondary Vancouver/world time is shown.
- Preloads rain radar tiles and refreshes map/radar resources on theme changes.

Client state behavior:

- Initial state is loaded from `/api/state`.
- A polling fallback runs every 5 seconds.
- State refreshes on focus, online, visibility/pageshow, and SSE updates.
- Optimistic entity and zone updates are applied for light interactions.
- Polling can be paused during light command holds and resumed afterward.
- Remote-setting UI controls that derive their displayed value from polled or
  SSE state must pause remote value adoption after local user input. Each
  implementation defines its own timeout; lighting controls use 10 seconds so
  slow Home Assistant refreshes do not rubber-band sliders or pickers while a
  command is settling.
- Climate entity actions, including the panel heater, apply optimistic UI state
  and hold dashboard refreshes for a longer settle window before the follow-up
  refresh so slow Home Assistant device reads do not rubber-band the controls.

### Slider Style

Every linear draggable control in the dashboard shares one rectangular slider
style so the dashboard, config pages, and camera controls look consistent. The
style is implemented by the shared `DotLineControl` component (which backs light
brightness, aircon fan speed, the camera processing sliders, theme sliders, and
all `SliderControlPanel` controls) and is mirrored by the Radix-based DVR
scrubber (`.camera-slider`). All slider colours come from the device theme CSS
variables, so they retint with the active theme.

- Track: a rectangular bar, as tall as the thumb, filled with the background
  colour (`--cyber-bg`) and outlined in the border colour at the configured
  border opacity (`--cyber-border-dim`).
- Thumb: a filled rectangle in the accent colour (`--cyber-line`), the same
  height as the track and outlined in the border colour at the configured border
  opacity (`--cyber-border-dim`) so the thumb and track outlines align. While the
  control is focused or being dragged, the thumb becomes a solid highlight-colour
  rectangle (`--cyber-highlight`) with no outline.
- Back-fill: an optional tinted area from the start of the track to the thumb,
  drawn in the accent colour. It is used for magnitudes that "fill up", such as
  brightness, intensity, and the camera processing sliders, and is omitted for
  stepped choices such as fan speed where the track stays a single colour. The
  `fill` prop toggles it; `SliderControlPanel` defaults it on because config
  sliders are magnitudes.
- Disabled: the thumb becomes an outlined rectangle in the border colour filled
  with the background colour, and the back-fill is dropped, leaving only the
  background-filled, border-outlined track.
- Config-page sliders have a strict save-on-release contract. Every
  `SliderControlPanel` requires separate `onPreview` and `onCommit` callbacks:
  drag ticks may update local visual state only, while release sends exactly one
  persistence request. Config sliders must never send network writes during a
  drag. Live interactive commands are reserved for dashboard controls.
- While a control is active, and for six seconds after release, dashboard and
  config reconciliation polling/pushes cannot replace its local value.

## 11. Navigation and Zones

Special zones:

- `everything`: whole-home/inside Home zone built by the server.
- `power`: rendered as `Grid`.
- `tasks`: rendered as `Reminders`.
- Configured network zone, rendered with router status.
- Climate zones, detected by configured climate area names and climate devices.
- Outside zones, detected by outside area/entity naming.

Zone buttons display:

- Zone name.
- Domain/entity counts.
- Context icons for lighting, climate, network, power, and tasks.
- Network live/offline status when applicable.
- Grid live kWh context.

## 12. Lighting and Zone Control

Zone actions are sent to `/api/zone`.

Supported zone actions:

- `on`
- `off`
- `brightness`
- `color`
- `candlelight`
- `white`

Lighting behavior:

- `off` turns off lights, illumination switches, and climate entities within
  the target zone.
- `brightness` with `0` turns off lights and illumination switches.
- `brightness` above `0` turns on illumination switches and sends brightness
  payloads to supported lights.
- `color` turns on illumination switches and lights, sends RGB payloads where
  supported, sends brightness when provided, and disables adaptive candlelight
  memory for that zone.
- `on` applies adaptive warm-white/candlelight behavior for light-capable
  entities and also turns on non-illumination switches.
- `candlelight` applies the adaptive candlelight/warm-white preset.
- `white` applies the white preset and disables adaptive candlelight memory for
  that zone.

Preset behavior:

- Warm white uses approximately 3000K where Kelvin control is available.
- Candlelight uses the warmest available Kelvin value, around 1800K when
  supported.
- White uses the coolest available Kelvin value, around 6500K when supported.
- RGB fallbacks are used when color temperature control is not supported.
- Configured min/max Kelvin ranges are respected.

Adaptive candlelight:

- The dashboard action labelled candlelight is sun-aware.
- During daylight it behaves as warm white at 100 percent brightness.
- At night it behaves as candlelight at 60 percent brightness.
- The UI label follows the current sun state.
- If a zone was last set through adaptive warm-white/candlelight, the server
  poller updates already-on lights when sunrise/sunset changes the sun state.
- The adaptive transition does not turn off lights on.
- Manual white or custom color disables remembered adaptive mode for the zone.
- The transition applies only to lights that were already on across the
  crossing. A zone with nothing on records the new sun state without sending
  anything, because the turn-on paths apply the preset for the live sun state
  themselves. Leaving it pending instead let the transition ambush the next
  manual set — a zone dimmed in the morning jumped to full a minute later.
- Setting a brightness or a custom colour records the live sun state for every
  adaptive zone containing the affected lights, including the aggregate `Home`
  zone. An entered value is the zone's intent for the current sun state, so the
  pending transition is consumed rather than allowed to overwrite it; the next
  real horizon crossing still transitions normally.
- After a `brightness` command the server checks back at 3 and 9 seconds and
  re-sends the commanded brightness to any light that is on and further than 2
  percent from it, then forgets the target. This makes a stalled fade reach the
  target without ever becoming a standing override of a change made from Home
  Assistant, a wall switch, or voice. Pinned fixtures are excluded (their own
  pass owns them), and an active house party suspends it.

Zone lighting UI:

- Lighting zones show On, adaptive warm-white/candlelight, White, and Off.
- A spectrum pad controls color.
- An intensity control sends brightness.
- Spectrum and brightness controls are disabled when there are no active
  controllable light devices.
- Local spectrum state is retained during the 10 second lighting remote-setting
  hold to avoid visual flicker and slider rubber-banding.
- Lights themselves still interpolate: fades are the intended look, and nothing
  here shortens them. What is forbidden is a *client* reading a point on that
  curve into a control as though the move had finished.
- In-flight results are published as such. While a light is still travelling
  toward a commanded brightness, the state carries `brightnessTransition` with
  the `targetPct` it is heading for — on the entity, and on every zone holding
  it, since one slow fixture makes a zone's averaged brightness provisional. The
  mark appears when the command is sent and clears as soon as the light is
  observed to have arrived, so its presence means a final value is still coming.
- Every client uses it, not just the one that issued the command: a zone's
  intensity control binds to `targetPct` while the mark is present, so a second
  dashboard shows the destination immediately rather than watching the fade, and
  no transitional reading can outlast a locally set value however long it holds.
- The spectrum dot may pan toward incoming colour readings, including
  mid-transition ones. That panning is display only — the spectrum issues light
  commands from pointer input alone and never from its own animation.
- The intensity control never interpolates. It takes every value whole via
  `DotLineControl`'s `snapRemote`, so its number and thumb are always a real
  value and never a frame of an animation between two of them. Other sliders
  keep the eased glide on incoming values; the prop is opt-in per control.
- The intensity control shows the brightness that was entered until the zone
  reports having reached it (within 3 percent), not for a fixed time. A zone's
  reported brightness is an average over its lit fixtures, each fading at its
  own rate, so values arriving mid-fade are interpolation artefacts and are
  never displayed. A brightness change made elsewhere is still adopted: it
  settles on one value, which a fade does not, so a non-matching value that
  holds for 4 seconds — and at least 12 seconds after the local set, leaving
  room for the server's convergence re-drive — replaces the entered value.
- The spectrum and intensity controls preview locally while dragging and send
  the color/brightness command to Home Assistant only when the control is
  released, so a drag never sends intermediate commands.

Shortcut lighting endpoints:

- `GET /api/lights/toggle` is the simple URL endpoint intended for iOS Control
  Centre shortcuts.
- `GET /api/lights/on` and `GET /api/lights/off` are explicit simple URL
  endpoints for the same indoor lighting layer.
- It targets the Home/Everything indoor lighting layer only: `light.*`
  entities and illumination-like switches in the Home zone.
- It ignores unavailable/unknown lighting entities when deciding the majority.
- If more indoor targets are on than off, it turns the indoor lighting layer
  off. Otherwise, including ties, it turns the indoor lighting layer on.
- Indoor shortcut `on` uses the same adaptive warm-white/candlelight preset as
  the dashboard zone On control: daylight is warm white at 100 percent, night
  is candlelight at 60 percent.
- `GET /api/outside-light/toggle` is the separate simple URL endpoint for
  outside lighting.
- `GET /api/outside-light/on` and `GET /api/outside-light/off` are explicit
  simple URL endpoints for the same outside lighting group.
- It targets light/illumination entities in the Outside zone, uses the same
  majority rule, and sends plain power on/off instead of the indoor adaptive
  preset.
- Each shortcut lighting group has an independent one-second in-process
  cooldown.
- Successful shortcut responses use `text/plain` and return only `on` or
  `off`, matching the state the endpoint set.
- Duplicate hits inside the cooldown do not send a second HA command and return
  the last accepted `on` or `off` text for that group when available.

### Config-driven fixture policy

These are per-home opinions about how individual fixtures behave inside zone
lighting actions, so they live in dashboard config (`homeAssistant` /
`dashboard.lighting`) rather than being hardcoded. They are generic features any
home can use; the Nova values live in `config/common.local.json` and the public
template documents them in `config/common.example.json`. Each rule keys off
Home Assistant entity ids, so it must be kept pointing at the live entity when a
device is replaced.

- **Zone exclusions** — `homeAssistant.everythingExcludedEntityIds` lists
  entities that are kept out of the aggregate Home/Everything zone, so editing
  Home lighting never touches them. The outside light is the canonical case: it
  stays its own Outside zone but is excluded from Home. Because it is keyed by
  entity id, every live outside-light entity must be listed (e.g. both an old
  `light.outside_light` and a replacement `light.tuya_mobile_outside_light`).
- **Mapping any entity into the lighting layer** — not every "light" is a
  `light.*` entity. A switch/outlet (e.g. neon on a smart plug) is treated as a
  light when it carries the `nova_illumination` label or is listed in
  `homeAssistant.classification.forceIlluminationEntityIds`. Once in the lighting
  layer it participates in all zone lighting actions and is eligible for the
  intensity-threshold rule below. A real on/off `light.*` (such as a
  switch-as-light helper) already qualifies.
- **Intensity thresholds** — `dashboard.lighting.intensityThresholds` map a
  lighting-layer entity to an on/off-only fixture with no dimming: it is
  suppressed (turned off) when the zone is set below `thresholdPct` and turned on
  at or above it. The neon lights, for example, only turn on when the Lounge is
  set to 60% or higher. The scheduled poller (`applyLightingIntensityThresholds`)
  keeps the fixture in sync with its zone's current intensity, turning it on/off
  as the zone crosses the threshold.
- **Pinned entity presets** — `dashboard.lighting.entityPresets` with
  `pinned: true` lock a fixture to a fixed look. A pinned light ignores whatever
  brightness/colour a zone command (On, brightness drag, colour pad, White,
  candlelight, the shortcut endpoints, and the scheduled adaptive transition)
  would apply and is instead always driven to its preset `targetBrightnessPct`
  and `colorTemperatureOverrideKelvin`. The conservatory room light is pinned to
  warm white (≈3000K) at 100% brightness day and night, so it never dims in the
  evening and is reapplied every time Home lighting is edited. A scheduled pass
  (`applyPinnedLightPresets`) re-drives pinned, currently-on fixtures whenever
  their live brightness/colour-temperature has drifted from the preset, and
  leaves pinned fixtures that are off alone. A preset without `pinned` only
  supplies the per-entity brightness/colour-temperature used by the adaptive
  On/candlelight presets; it does not override manual brightness/colour edits.

## 13. Entity Control

Entity actions are sent to `/api/entity`.

Allowed domains:

- `light`
- `switch`
- `climate`
- `fan`
- `cover`
- `humidifier`

Sensors are read-only.

Climate service allowlist:

- `turn_on`
- `turn_off`
- `set_hvac_mode`
- `set_temperature`
- `set_fan_mode`
- `set_swing_mode`

Other supported domains are limited to the service patterns used by the UI.

Entity actions can include a `remember` payload. Remembered values are merged
into dashboard preferences after the HA call succeeds.

Aircon-related entity actions are logged with extra detail for debugging.

## 14. Climate Controls

Climate controls are composed from entities detected in the selected climate
zone.

Recognized lounge aircon components:

- Main climate entity.
- Fresh air switch.
- Quiet mode switch.
- Turbo mode switch.

Recognized panel heater components:

- Main climate entity.

Panel heater UI:

- Target temperature stepper.
- Power state buttons: On, Off.
- Off timer row using the configured climate off-timer increment.
- Current source code uses whole-degree target steps.
- Temperature and timer controls are enabled only when the heater is on.
- The timer counts down in real time, can be cleared from the timer row, and
  turns the panel heater off when it expires.
- Timer state is persisted in dashboard preferences as
  `panelHeater.offTimerEndsAt`.

Air conditioner UI:

- Target temperature stepper.
- Power state buttons: Auto, Manual, Off.
- Off timer row using the configured climate off-timer increment.
- Manual HVAC mode buttons: Heat, Cool, Fan.
- Current source code uses whole-degree target steps.
- Fan speed control across quiet, low, medium low, medium, medium high, high,
  and turbo. The fan speed slider previews the step locally while dragging and
  sends the command only when the slider is released.
- Fresh air switch.
- The timer counts down in real time, can be cleared from the timer row, and
  turns the air conditioner off when it expires.
- Quiet and turbo fan endpoints coordinate with dedicated quiet/turbo switches.
- Manual turn-on reapplies remembered mode, temperature, fan, quiet/turbo, and
  fresh air preferences where available.

## 15. Dashboard Auto Aircon

Dashboard Auto is implemented by this app. It is not Home Assistant/Gree auto
mode.

The core invariant is:

`delta = measuredRoomTemperature - selectedTargetTemperature`

- `delta > 0`: room is warmer than target, so cool.
- `delta < 0`: room is colder than target, so heat.

This invariant is documented in `docs/aircon-auto.md` and covered by
`lib/aircon-control.test.ts`.

Planner details:

- The planner is React-free and lives in `lib/aircon-control.ts`.
- Poll interval constant is 1000 ms.
- Auto measures the Gree unit's own `current_temperature`. That sensor sits
  downstream of the compressor it controls, and every guard below is sized
  against its behaviour rather than against comfort. `sensor.lounge_temperature`
  reads the same attribute and is display-only; it must never feed control.
- Supported modes are heat, cool, fan-only, and auto. Auto only ever commands
  heat or cool.
- Fan steps range from quiet through turbo.
- When driving, the planner chooses fan strength from the absolute delta.
- Hysteresis is asymmetric: the unit is switched **off** the moment the reading
  reaches target, and does not resume until the reading is 3 degrees past it.
  Auto switching the unit off is normal — the remembered `autoMode` preference,
  not the unit's power, drives the dashboard's power display.
- Reversing heat/cool is held for 30 minutes from the last direction change;
  restarting the compressor is held for 10 minutes from the last state change;
  and at most 3 compressor starts are allowed in any trailing hour. None of these
  can delay turning the unit **off**.
- A target the user moved reopens a resting cycle inside the resume band, so a
  new setpoint is never ignored until the room drifts.
- Auto's cycle state (`autoLastMode`, `autoLastModeAt`, `autoLastTransitionAt`,
  `autoRecentStartsAt` in `preferences.aircon`) is persisted on the `remember`
  payload of every transition, because the loop's own state is per browser tab
  and would not survive a reload.
- If the desired mode is unsupported, the planner rests rather than using an
  unsafe fallback.
- Force-remember actions can update stored auto preferences without immediately
  requiring an HA mode change.
- Breaking the 30-minute direction hold is decided in the UI, not the planner:
  pressing Heat/Cool, or moving the setpoint more than 1 degree past the current
  reading. See `docs/aircon-auto.md`.

Client behavior:

- The dashboard runs the auto thermostat while `preferences.aircon.autoMode` is
  true.
- It skips ticks while hidden or while another climate action is applying.
- It decides from the shared SSE/poll snapshot; it must not fetch per tick.
- It reconciles the durable cycle state from preferences before each tick.
- It applies the planned HA actions through `/api/entity`.
- It emits `aircon-auto` per acting tick and `aircon-auto-held` once per change
  of blocking reason, both carrying the planner's `reason` and `wantedMode`.

## 16. Outside, Weather, and Map

Outside controls:

- The outside panel controls the first outside light/illumination device in the
  outside zone.
- It renders `CameraPanel` for camera ID `outside`, followed by weather and the
  map panel.

Outside camera and DVR:

- The production source is a MacroSilicon MS210x / EasierCAP S-Video capture
  adapter (`534d:0021`, serial `20200909`) connected to Nova.
- The recorder opens the stable container path
  `/host-dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0`
  as V4L2 MJPEG at 720x480 and 25 fps. The device does not expose a V4L2
  PAL/NTSC standard control, so production sets the standard option to `none`.
- One long-lived ffmpeg process captures the source and writes two-second H.264
  MPEG-TS segments plus `index.m3u8` under `data/camera/outside/`.
- The playlist is a rolling two-hour window with program-date-time tags. ffmpeg
  deletes rolled-off segments, and the recorder also sweeps orphaned files and
  refuses to serve expired segments.
- The camera panel supports live playback, play/pause, scrubbing through the
  available DVR window, and a Live button that returns to the live edge.
- The captured 720x480 frame is displayed in a 16:9 stage. The DVR output is
  anamorphic/widescreen, so the video uses `object-fit: fill` to map the complete
  frame into 16:9, correcting its apparent vertical stretch without cropping or
  changing the recorded pixels.
- Browser playback prefers native HLS where supported (notably Safari/WebKit)
  and uses hls.js elsewhere. A configured remote video host is fetched through
  Nova's same-origin `/api/camera-proxy/...` route so HTTPS clients never load
  an HTTP camera stream as mixed content.
- Recorder startup is idempotent, automatically retries failed ffmpeg processes
  with bounded backoff, and pauses during dashboard self-update builds.
- When `NOVA_CAMERA_OUTSIDE_DEVICE` is unset or its path is absent, the recorder
  uses the retained ffmpeg `testsrc2` signal and live clock generator. This
  fallback must remain installed even while physical capture is active.
- Static demo mode has no server recorder; it renders the equivalent animated
  clock placeholder on a canvas and leaves DVR scrubbing inactive.
- The panel displays source/connection state and an offline overlay when no
  playable recorder output is available.
- Camera hardware image controls are host-side V4L2 controls, not dashboard
  preferences. `v4l2-utils` is installed on Nova. The capture stick exposes
  brightness `0..255` (default 26), contrast `0..255` (default 140), saturation
  `0..255` (default 150), hue `-128..127` (default 0), and backlight
  compensation `0..255` (default 0).
- Manual brightness changes use the stable host path, for example:

```bash
v4l2-ctl -d /dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0 --set-ctrl=brightness=10
```

- Reset brightness with `--set-ctrl=brightness=26`. Hardware controls may
  return to device defaults after a reboot or USB reconnect.
- `nova-ha-dashboard.service` resets the adapter to its advertised hardware
  defaults before every launch: brightness 26, contrast 140, saturation 150,
  hue 0, and backlight compensation 0. The command is optional so an unplugged
  adapter does not prevent the synthetic fallback from starting.
- Stable user tuning is applied downstream in ffmpeg rather than through the
  adapter's volatile/automatic image processing. The physical feed supports
  `NOVA_CAMERA_OUTSIDE_BRIGHTNESS` (`-1..1`, neutral 0),
  `NOVA_CAMERA_OUTSIDE_CONTRAST` (`0..2`, neutral 1), and
  `NOVA_CAMERA_OUTSIDE_SHARPNESS` (`0..5`, neutral 0). Brightness and contrast
  use ffmpeg `eq`; sharpness uses the luma channel of `unsharp`.
- These software filters apply only to the device source. The synthetic signal
  test retains its own drawbox/drawtext filter chain unchanged.
- `/config` includes a Camera accordion with a compact live HLS preview and
  brightness, contrast, and sharpness sliders in the shared rectangular slider
  style. Apply persists the values under `dashboard.camera.outside.processing`
  and restarts only the outside recorder; the preview reconnects automatically
  while the restarted recorder warms up (the playlist 404s for a second or two),
  and the dashboard and Home Assistant remain running.
- A Reset button restores the panel defaults: brightness -0.12, contrast 1.1,
  and sharpness 0.6.
- Iridium runs the recorder-independent `nova-camera-events.service`, consuming
  the configured remote HLS feed and exposing its private API on localhost
  port 8098. The dashboard proxies event metadata/media through same-origin
  `/api/camera/<id>/events` routes.
- Daytime YOLO detection records people, cats, dogs and other non-bird animals;
  vehicles supply proximity context rather than generating ordinary traffic
  events. Normalized activity, vehicle and exclusion polygons are edited
  visually in Camera configuration; existing vertices are draggable. The editor
  defaults to the last persisted daylight frame so zones remain editable after
  dark, with an explicit switch back to the live frame. That calibration cache
  is permanent runtime data: event retention does not remove it and camera
  processing never replaces it automatically.
- Event media is a representative JPEG and an MP4 remux with 10-second pre-roll
  and 20-second post-roll. Unstarred retention is 14 days or 50 GB, with a
  20-GB host reserve; starring excludes an event from automatic retention.
- Event review supports a selection mode, selecting every event visible under
  the current filter, and one confirmed bulk deletion of selected clips.
- Moondream2 performs queued, best-effort observable-behavior descriptions.
  Important/urgent Home Assistant alerts wait for that detailed pass. Machine
  labels never claim human identity or intent and uncertain cat/ute reference
  matches remain explicitly tentative.

Weather panel:

- Displays current condition, feels-like, current temperature, min/max, rain
  chance, UV, wind, and humidity when present.

Map panel:

- Client-only MapLibre GL component.
- Default center is Auckland and can be configured.
- Uses an OpenFreeMap vector source.
- Uses RainViewer radar through `/api/radar`.
- Uses Esri satellite imagery through `/api/satellite`.
- Displays background, landuse, satellite, water, radar, roads, buildings,
  street labels, place labels, and a home marker.
- 3D building extrusions vary color and opacity by render height and zoom.
- Theme is driven by CSS variables controlled from `/config`.
- Navigation controls are present.
- Scroll wheel uses custom eased zoom around cursor.
- W/A/S/D panning is supported while the mouse is held.
- Right-drag rotation is supported.
- Context menu is disabled.
- Radar source refreshes every 60 seconds and changes tile bucket every
  5 minutes.
- `nova-accent-change` reapplies map theme.

Radar tile proxy:

- Route: `/api/radar/[z]/[x]/[y]`
- Fetches RainViewer manifest with fallback host support.
- Caches manifest for roughly 4 minutes.
- Validates tile coordinates.
- Maximum radar zoom is 7.
- Returns transparent PNG for invalid or missing data.
- Can recolor radar PNGs using `sharp`.
- Cache-control permits short public caching with stale revalidation.

Satellite tile proxy:

- Route: `/api/satellite/[z]/[x]/[y]`
- Proxies Esri satellite tiles.
- Applies tint/brightness processing with `sharp`.
- Returns a black fallback tile on failure.
- Supports zoom up to 19.
- Uses long cache-control with stale revalidation.

## 17. Router and Network Panel

The network panel is rendered for the configured network zone.

Behavior:

- Polls `/api/router` every 333 ms.
- Refreshes on focus, visibility, online, and pageshow events.
- Keeps the last known good router metrics during transient misses.
- Shows download gauge, download/upload bars, WAN status, and live/offline
  state.

Server behavior:

- `/api/router` returns router-only dashboard state.
- It uses no-store cache headers.

## 18. Power Monitoring

`lib/power.ts` estimates live electricity usage and cost.

Data sources:

- Current Home Assistant states.
- Explicit power sensors when available.
- Device wattage ratings.
- Device brightness/color state.
- Climate mode/temperature state.
- Integrated local sample history.
- Optional Powershop account usage scrape files.
- Configured modeled base loads.
- Hardcoded Powershop rates for known 2025/2026 plans unless overridden by
  data/config in future code.

Files:

- `state.json`
- `device-ratings.json`
- `account-usage.json`

Estimation behavior:

- Explicit power sensors override modeled estimates.
- Lights and illumination switches estimate standby/off and active watts.
- Light brightness scales estimated watts.
- Color can apply an additional factor where modeled.
- Climate estimates include standby/off, fan/dry, Gree heat/cool input watts,
  and generic climate load based on temperature delta.
- Panel heater estimates reduce draw when target appears satisfied.
- Modeled base loads include fridges, water heater, desktop PC, and Nova
  always-on load.

Integration behavior:

- Samples are serialized.
- Elapsed hours since the previous sample are capped by configuration.
- Daily and hourly buckets are updated.
- Per-device kWh and cost are accumulated.
- Billing cycle is based on configured day-of-month start/end and the
  `Pacific/Auckland` timezone.

Output includes:

- Current rate.
- Current watts.
- Current cost per hour.
- Day/week/billing/year summaries.
- Billing projection.
- Account usage curve.
- Account rate curve.
- Recent usage curve.
- Background/base-load estimates.
- Top devices.
- Rate source warning when source fetch/hash validation fails.

MQTT/Home Assistant publishing:

- The power monitor publishes MQTT discovery and state through the HA
  `mqtt.publish` service.
- Published sensors include per-device estimated power/energy/rated power and
  home estimated power.
- Discovery and state publish intervals are configurable.
- Messages use retain.

Power UI:

- The Grid zone renders `PowerPanel`.
- It polls `/api/power` every 5 seconds and on visibility/focus/online/pageshow.
- It toggles display between credits/cost and kWh.
- It shows current use, daily estimate, billing estimate, billing-to-date,
  curves, summaries, inferred base loads, and top devices.

Powershop scrape:

- `scripts/powershop-daily-scrape.mjs` uses Playwright to log into Powershop,
  capture usage data, normalize it, and write daily JSON records.
- Credentials come from `POWERSHOP_EMAIL` and `POWERSHOP_PASSWORD`.
- The scraper supports dry-run, target date, storage state, template path,
  data directory, and headful/headless options.
- MFA challenge pages are not treated as authenticated dashboard sessions; a
  successful dashboard check refreshes the saved Playwright storage state at
  `storage-state.json` in the Powershop data directory.
- MFA login codes can be supplied with `--login-code`, `POWERSHOP_LOGIN_CODE`,
  or by keeping the same browser session open with `--wait-for-login-code`.
  When running through the Docker wrapper, the file-based form
  `--wait-for-login-code --login-code-file /data/login-code.txt` lets the
  operator write the temporary code into the host data directory without
  starting a second Powershop login session.
- After authentication, the scraper calls Powershop's authenticated
  `measurements` GraphQL query directly for hourly consumption records. It
  derives kWh from measurement `value` and cost from `CONSUMPTION_COST` plus
  `STANDING_CHARGE_COST` `costInclTax.estimatedAmount` statistics, then keeps
  the older page/network scrape as fallback evidence.
- `scripts/run-powershop-daily-scrape.sh` runs the scraper in a Playwright
  Docker image with host networking and logs to the data directory.
- `scripts/install-powershop-cron.sh` installs a cron entry at `8 5 * * *`
  for the runner under `/opt/nova-ha-dashboard` by default.

GymMaster attendance scrape:

- `scripts/gymmaster-attendance-scrape.mjs` uses Playwright to log into the
  AllFit GymMaster member portal and open `/portal/account/visithistory`.
- Credentials come from `GYMMASTER_EMAIL` and `GYMMASTER_PASSWORD`; they must
  live in the runtime environment or Nova `.env.local`, never in source.
- The scraper reuses a Playwright storage state file under the GymMaster data
  directory after successful login.
- The scraper extracts candidate visit timestamps from the visit-history DOM
  and relevant captured portal responses, chooses the newest non-future visit,
  and writes `data/gymmaster/latest.json`.
- On success, the scraper updates `/api/watchface` with
  `gymLastResetAt: <latest visit ISO timestamp>` so the avatar and watchface
  share the same counter source. If the API is unreachable, it falls back to
  updating the dashboard preferences file directly.
- The scraper writes only compact status/evidence metadata and selected
  timestamp output; it does not store the GymMaster password or raw portal
  HTML.
- `scripts/run-gymmaster-attendance-scrape.sh` runs the scraper in a
  Playwright Docker image with host networking, a non-overlap lock, mounted
  dashboard data, and logs under `data/gymmaster/logs`.
- `scripts/install-gymmaster-cron.sh` installs the requested scrape cadence:
  every 15 minutes from 20:00 through 02:00 and once per hour from 03:00
  through 19:00 in the Nova host's local timezone.

## 19. Tasks

Tasks are stored and managed by `lib/tasks.ts`.

Task sources:

- `local`
- `icloud-calendar`
- `icloud-reminders`

Task fields:

- `id`
- `name`
- `start`
- `end`
- `createdAt`
- `dismissedAt`
- `alertDismissedAt`
- `alertDismissedFor`
- `alertChimedFor` — alert session key whose chime has been played, shared
  across every screen
- `annoy` — repeat the chime until dismissed; off by default
- `repeat`
- `source`
- `sourceId`
- `sourceCalendar`
- `occurrenceDate`
- `readOnly`

Repeat support:

- Hourly.
- Morning-night, meaning a 12-hour cadence.
- Every N days, with N from 1 to 365.
- Repeat duration must be shorter than its interval.

Task store behavior:

- Missing task file reads as empty.
- Invalid rows are normalized or discarded.
- Completed repeating tasks advance to their next occurrence after the current
  occurrence passes.
- Accidentally dismissed current repeating occurrences are repaired.
- Mirrored/read-only iCloud tasks cannot be edited with local update APIs.
- Alert dismissal is separate from task completion.
- Completing a repeating task advances it where appropriate.
- Task operations broadcast task events to SSE clients.

CSV task parser:

- Input format is `start,end,name[,repeat]`.
- Blank lines and comment lines are ignored.
- Time-only values use the reference date.
- If an end time-only value is before the start, it rolls to the next day.
- Repeat values accept hourly, morning-night/morning/night, days:N, or a bare
  integer day count.

Reminders UI:

- `TasksPanel` is always mounted so current-task state can be tracked, but the
  full panel is shown when the Reminders zone is selected.
- A current task bar can appear while another zone is selected.
- Initial task state is loaded from `/api/tasks?command=list`.
- Realtime updates come from `/api/events`.
- Local time ticks every second.
- Tabs are Today and Upcoming.
- Today includes current tasks and tasks starting today.
- Upcoming includes tasks starting tomorrow or later.
- Reminders ended before today are hidden.
- Status labels include Active, Due, Done, and Upcoming.

Task editing:

- Local tasks can be created and edited inline.
- Fields include name, start, optional end, and repeat settings.
- iOS-style edit mode supports selection and deletion.
- Completing a task calls `/api/tasks/[id]/complete`.
- Dismissing only the reminder calls `/api/tasks/[id]/dismiss`.
- Mirrored iCloud tasks show source metadata and are read-only.
- Mirrored tasks can be converted to local by cloning through the add API and
  deleting the mirrored local copy.

Task alerts:

- Server alert scanning runs every second while clients are connected.
- A task alert is emitted as a rising edge when a task enters its alert window.
- Banners are a **per-device opt-in**, off by default:
  `nova.dashboard.reminderBanner.v1`
  (`app/components/dashboard/reminderBannerSetting.ts`), surfaced as the
  Reminder Banners checkbox in Appearance & Dashboard → Reminders. The switch
  covers the bottom bar and the full-screen overlay. It does **not** govern the
  sound cadence — that is per-reminder, see below.
- With banners ENABLED:
  - The client adds `task-alerting` to the body.
  - Overlay/banner UI is shown.
  - Clicking/tapping outside the banner in capture phase dismisses the alert
    and swallows that tap.
  - Clicking the banner also dismisses the alert.
- With banners DISABLED:
  - No bottom bar and no overlay are rendered, and the capture-phase tap
    swallow is not installed — it would otherwise eat taps meant for the
    reminder icon bar.

Alert audio:

- Audio plays from `/api/tasks/audio` when an MP3 exists.
- A reminder chimes **once per occurrence, household-wide**. The first screen
  to play it claims the occurrence via `POST /api/tasks/:id/chimed`, which sets
  `alertChimedFor` to the alert session key and broadcasts the task. Every
  other screen — and every subsequent page load, which is where a still-active
  reminder used to re-chime on every refresh — sees the claim and stays quiet.
  Dismissing the alert also spends the chime, so a dismissal implies silence
  even if the sound never actually played.
- `alertChimedFor` is cleared exactly where `alertDismissedFor` is: repeat
  roll-forward, completion, and any reschedule that moves `start`/`end`. A new
  occurrence gets a new chime.
- A reminder with `annoy: true` (the "Keep chiming until dismissed" checkbox in
  the reminder editor) is exempt: it repeats on the configured interval until
  dismissed, ended, or completed, and ignores the once-per-occurrence claim.
  Off by default.
- Audio window and repeat interval come from `tasks.alertAudio.alertWindowMs`
  and `tasks.alertAudio.repeatMs`, delivered over `/api/config/client`.
- Browser audio blocking is logged rather than treated as fatal.

Reminder icon bar:

- A fixed row of sigils between the clock and zones panels
  (`app/components/dashboard/ReminderIconBar.tsx`), rendered on every device
  regardless of the banner setting.
- Placement by layout:
  - Portrait / narrow: a full-width row spanning the shell, between the clock
    and the zones panel.
  - Wide landscape (`min-width: 1126px` and `orientation: landscape`): the bar
    moves into the 300px sidebar column, centred under the status orb — which
    the same breakpoint centres on that column — and sitting directly on top of
    the zones menu. Tiles wrap within the column width rather than overflowing
    it, so a full roster reads as two short rows.
- Sigils come from a curated Phosphor catalogue (`lib/reminder-glyph.ts`,
  joined to components in `app/components/reminders/icon-registry.tsx`) plus a
  1-2 character text glyph option for reminders that are a letter ("E").
- Assignments live in `lib/reminder-icons.ts`, keyed on the **normalised
  reminder name**, not the task id — iCloud mirrors are regenerated with fresh
  ids on every sync, and `updateTask` refuses to write to a mirrored task at
  all, so a name key is the only way a read-only Apple reminder can carry a
  user-chosen icon.
- Assignment order on first sight of a reminder: existing entry (a user choice
  is permanently sticky) → keyword table → LLM → generic bell. The LLM step is
  asynchronous and best-effort; it never blocks or fails a reminder write.
- The LLM is reached at `POST /v1/classify-icon` on the voice orchestrator,
  which proxies to the loopback-bound `llama-server`. The catalogue id list is
  sent as an allow-list, compiled into the response schema as an enum and
  re-validated on both sides.
- Bar membership: a repeating reminder (local `repeat`, or an iCloud RRULE
  recorded as `Task.recurs`) auto-joins; one-offs get a sigil but no tile.
  Toggling membership by hand sets `showInBarLocked` and the auto rule stops
  applying to that reminder.
- Tile state: dimmed to `dashboard.reminders.inactiveOpacity` when nothing is
  due, full opacity when due or active, and a slow glow pulse in the orb's
  alert colour once overdue past `dashboard.reminders.overduePulseAfterMs`.
  The pulse colour is published as `--nova-alert-rgb` from the theme's avatar
  `gradientAlert` slot.
- Overdue is `isTaskOverdue` in `app/components/tasks/task-model.ts`, a
  separate axis from `statusForTask` (which collapses everything past its end
  into "Done"). Note a repeating LOCAL task that has an end rolls itself
  forward and so is never overdue; end-less reminders and iCloud mirrors are
  what actually reach the state.
- Tapping a tile completes its reminder. Pressing and holding for
  `undoHoldMs` within `undoWindowMs` of that tap restores it through
  `POST /api/tasks/[id]/uncomplete`, which replays a pre-completion snapshot —
  completing a repeating reminder also rolls it to the next occurrence, so
  clearing `dismissedAt` alone would not undo anything.
- Lite mode: everything animated here is CSS, so the `html[data-nova-lite] *`
  kill-switch neutralises the pulse. No rAF, no canvas, no polling of its own
  (the 1s tick and the task feed are both shared), so no `useLiteMode()` gate
  is required.

Task import/export:

- Import modal exposes iCloud status and Sync Now.
- CSV text can be previewed and validated.
- Bulk import posts to `/api/tasks/bulk`.
- Export emits local tasks as `start,end,name,repeat` text.
- Export replaces commas in task names with spaces.

## 20. iCloud Sync

`lib/icloud-config.ts` reads iCloud sync configuration from dashboard config
and environment variables.

iCloud sync is enabled only when both `ICLOUD_USERNAME` and
`ICLOUD_APP_PASSWORD` are set.

Sync behavior:

- Uses CalDAV at `https://caldav.icloud.com` by default.
- Uses Basic auth through `tsdav`.
- Discovers calendars/reminder lists.
- Filters by configured calendar/reminder allowlists when present.
- A calendar or reminder allowlist containing `none` or `__none__` disables
  that source entirely.
- Sync window starts at now and extends by configured sync days.
- Default sync window is 7 days.
- Default background sync interval is 5 minutes.
- Auth failures set a backoff and emit a dashboard error.

VEVENT mapping:

- Timed calendar events become read-only tasks.
- All-day events are skipped.
- Recurrence is expanded with a safety cap.
- Recurrence exception components are ignored by current code.
- Each occurrence receives a deterministic ID.

VTODO mapping:

- Reminder lists are queried with an explicit `VTODO` CalDAV filter.
- Completed reminders are skipped.
- Date-only reminders are scheduled at the configured local default reminder
  hour. No-due reminders are skipped because the dashboard has no unscheduled
  task bucket.
- Timed due dates become read-only tasks.
- If both DTSTART and DUE are available, DTSTART is start and DUE is end.
- If only DUE is available, DUE is start and default duration is used.
- Simple daily, weekly, monthly, and yearly recurring VTODO due dates are
  advanced into the current sync window.
- Apple's CalDAV placeholder reminders for upgraded/shared lists are ignored.

Diff behavior:

- Local tasks are preserved.
- Local tasks that match an iCloud Reminder by normalized name and current
  local occurrence date are linked by removing the local duplicate so the iOS
  reminder takes precedence. Repeating local tasks are linked when their
  normalized name matches an iCloud Reminder occurrence.
- Mirrored tasks are added, updated, or removed to match iCloud.
- Unchanged mirrored tasks preserve dismissed and alert-dismissed fields.
- Sync status records last sync time, calendars, reminders, errors, and backoff
  state.

## 21. Theme and Configuration UX

Device theme is managed by `app/components/accentColor.ts`.

Storage:

- Local theme key: `nova.dashboard.accent.v1`.
- Config scope key: `nova.dashboard.configScope.v1`.
- Shared theme is stored in dashboard preferences through `/api/theme`.
- Dashboard theme preferences are stored as a theme set:
  `selection: "dark" | "light" | "auto"` plus `themes.dark` and
  `themes.light`. Legacy single-theme payloads are still accepted and are
  normalized into both variants.
- Status Orb visual settings are stored under each theme variant as
  `themes.dark.avatar` and `themes.light.avatar`, and a present per-variant
  avatar is authoritative: its values alone skin that theme's orb. API theme
  reads never merge the single global `dashboard.avatar` into a present avatar
  — doing so made every theme inherit one global gym number colour, so picking
  different themes appeared to swap the gym colour or show another theme's.
  Fields a theme omits are filled with per-field defaults by the client/orb
  normalisers, not by another theme's colours, and a present
  `avatar.gymNumberColor` (including an intentional black/zero-intensity color)
  is preserved. The old `dashboard.avatar` config is consulted only to seed a
  variant that has no avatar object at all (a pre-per-variant install).
- Auto fullscreen is not a theme field. It is a standalone per-device setting
  stored in localStorage under `nova.dashboard.autoFullscreen.v1`; the value
  migrates out of the legacy theme entry on first read. The server still
  strips a legacy `autoFullscreenOnLoad` field from incoming theme payloads.
- The experience mode (§31) is likewise a standalone per-device setting, never
  part of a theme. It is four independent feature toggles — status orb,
  background, camera, and world map. The `/config` "This Device" section
  exposes them as four checkboxes ("Show Status Orb", "Show Background", "Show
  Camera", "Show World Map"); the first-run modal offers the two coarse
  choices (Full Experience = all on, Lite = all off). Toggling any of them
  settles the first-run choice, so the chooser modal never appears afterwards
  on that device.

Theme fields:

- Every theme field below belongs to an individual variant under
  `themes.dark` or `themes.light` in the persisted theme set.
- Accent color.
- Highlight color.
- Background color.
- Background fluid/effect knobs.
- Border color, opacity, and enabled state.
- Map base, water, land, building, road, label, and satellite settings.
- Radar palette, custom radar low/high colors, and radar opacity.
- Reminder glow intensity.
- Dashboard title tone.
- Dashboard title light/dark text colors.
- Status Orb gradient, line, gym counter, and alert colors/opacities.
- Desktop wallpaper landscape/portrait asset references. Portrait targets fall
  back to the landscape asset when the portrait reference is empty.
- Status Orb module selection (`avatar.orbModule`) — which orb module the
  variant renders with (see Status Orb Modules).
- Code defaults write the existing shared theme baseline into both dark and
  light theme variants, including the dark neutral base, purple highlight,
  custom yellow/green radar palette, subdued water overlay, and soft title
  colors. Default selection is Dark for backward compatibility.

Runtime behavior:

- Theme is applied before React render where possible.
- `useDeviceTheme` returns the resolved active `DeviceTheme` for dashboard
  consumers and the full `DeviceThemeSet` for config editing.
- Theme selection controls the active variant. Dark always resolves to
  `themes.dark`; Light always resolves to `themes.light`; Auto uses Home
  Assistant sun state so Dark is shown at night and Light is shown during the
  day. The resolver prefers `below_horizon`/`above_horizon`, falls back to
  `nextRising`/`nextSetting`, then falls back to the local clock if sun data is
  unavailable.
- Dashboard state publishes sun changes to the browser theme hook so Auto can
  switch at sunrise/sunset without requiring a reload.
- CSS variables drive dashboard, map, radar, reminder glow, and title styling.
- Shared scope polls `/api/theme` at the configured interval.
- Local scope syncs through storage events.
- Theme changes dispatch `nova-accent-change`.
- Auto fullscreen is active on the dashboard and config screens when the
  per-device setting is enabled; it checks on mount, common
  page/fullscreen/user events, trusted click/touch/keyboard events captured at
  document level, and every 60 seconds.
- Navigation between the dashboard and config pages uses Next.js client-side
  routing (`next/link`) so moving between pages never unloads the document and
  fullscreen is preserved across page changes.
- The config page has a single Back action for returning to the dashboard.
  Dashboard/theme settings save immediately as they are changed. The Theme
  Library controls remain separate Save/Save As/Load actions for saved theme
  entries and are not dashboard-exit controls.
- Browser DOM fullscreen remains subject to Brave/Chromium user-activation
  rules; a plain page refresh may reject script-requested fullscreen until the
  next trusted in-page gesture.
- `/api/theme` handles dashboard theme updates only. Namespaced theme-set
  writes replace the stored theme set and always carry both dark and light
  variants so hidden config tabs are preserved. Legacy single-theme partial
  writes are still merged for compatibility. Status Orb writes from the config
  page update the active theme variant's `avatar` field.
- Theme saves never push wallpapers to managed desktops. Wallpaper sync is
  triggered explicitly and is screen-aware, so editing the theme in config —
  including selecting a different wallpaper or moving the Theme selection
  slider — sends no desktop command while config is open. There are exactly two
  automatic triggers: leaving the config page (Back) syncs once, and a dark/
  light flip that happens while the main dashboard is open syncs once. The flip
  trigger lives in the dashboard component, so it never fires on the config
  screen.
- Managed-desktop wallpaper sync is de-duplicated. The automatic path (Back and
  dashboard dark/light flip) records the last successfully applied asset
  signature per computer in ignored runtime state under `data/` and skips
  unchanged target/asset pairs, so the same wallpaper image can never be sent
  to a computer twice in a row — an automatic request is dropped when the new
  desktop matches the last one applied. The manual Apply Desktop Wallpapers
  button is the one force path, for recovering a machine whose wallpaper was
  changed outside Nova.

Config page:

- Config Source and Fullscreen controls sit at the very top of the config page
  before the accordion list.
- Every config section accordion shows a section-appropriate icon before its
  title, drawn in the title text colour, and all sections (including Camera)
  start collapsed.
- A Theme selection slider sits immediately below those top controls, with
  Dark, Light, and Auto positions.
- Dark and Light tabs sit below Theme selection and switch which theme variant
  is being edited. The Theme Settings accordion is rendered inside the active
  tab, and any theme write saves the full dark/light theme set.
- The remaining top-level sections are ordered as Theme Settings, Climate
  Controls, Hardware Assistant, Secrets, and Config Import/Export.
- Theme Settings contains collapsed sub-accordions ordered as Theme Colours,
  Status Orb, Apple TV, Map, and Reminders inside each theme-edit tab.
- Theme Colours contains the former dashboard component controls as the first
  items, plus the title text tone and light/dark title color widgets.
- Map contains the former map component controls plus Rain Radar settings.
- The active Local/Shared config source button is highlighted with the current
  highlight color.
- `ConfigWorkspace` shows one Back link, hides raw JSON editing and manual
  validation, and exposes config import/export only as Import and Export
  buttons.
- `AccentConfig` edits dashboard theme, reminder glow/audio preview, map
  colors, radar palette, satellite settings, border, and background behavior.
- Reminder glow preview temporarily adds alert styling and plays the uploaded audio
  sample if present.
- `NovaAvatarConfig` edits Status Orb gradient, gradient alert, line colors,
  line opacities, gym number color, gym number opacity, and the gym alert
  threshold in hours as part of the active dark/light dashboard theme.
- `NovaAvatarConfig` opens with an orb module drop-down at the very top of
  the Status Orb section, styled after the theme library's cyber-select
  control (trigger with name/description and chevron, listbox menu, outside
  click/Escape to close). It lists every available orb module — built-ins
  plus host-deployed module files, fetched via `useOrbModules` — and each
  entry carries a thumbnail swatch rendered by the real module renderer in
  the colors of the theme being edited. Choosing a module writes
  `avatar.orbModule` on the theme being edited and the forced preview avatar
  re-renders with the new module immediately.
- `WaveshareWatchfaceConfig` is presented as Hardware Assistant and only shows
  hardware assistant controls such as the watchface idle/power timer. The old
  gym counter readout is removed from this section because gym alert config is
  managed in Status Orb.
- The forced config preview avatar always renders the gym-alert pulse so the
  configured alert color can be inspected even when the real counter is below
  the alert threshold.

Color decision:

- Project memory records that dashboard controls and chrome should use the
  established dashboard UI color tokens/variables. Future changes should not
  introduce arbitrary new control colors. Power graph curve colors are an
  accepted exception.

## 22. Nova Avatar and Host Load

`NovaAvatar` is a canvas visualization mounted in the root layout.

Visibility:

- Hidden on `/config` except where a forced preview is rendered.
- Visible on the dashboard shell.
- Never mounted on lite-mode devices (§31): the gate component returns null,
  so none of the polling or the canvas loop runs, and the head bootstrap hides
  the SSR markup via `html[data-nova-lite] .nova-avatar-host` before first
  paint. Config previews pass `forceVisible` and are never suppressed.

Data:

- Polls `/api/nova-load` every 100 ms.
- Receives CPU load, network load, GPU load, assist-satellite listening state,
  composite load, and timestamp.
- Composite load is the maximum of the individual load channels.

Server load sources:

- CPU from `/proc/stat` deltas.
- Network from `/proc/net/dev`, excluding loopback and common container/bridge
  interfaces.
- GPU from `nvidia-smi` when available.
- Listening state from the configured Home Assistant assist satellite entity.

Visual behavior:

- All drawing is delegated to the status orb module named by the active
  theme's `avatar.orbModule` field (see the Status Orb Modules section for
  the format, renderer, and fallback rules). `NovaAvatar` owns only the
  canvas surface, frame timing, load easing, the per-frame theme palette,
  and the gym counter overlay.
- The default `classic` module draws the original look: circular orb with
  radial gradient, fifty additive glowing arc segments, glass bevel, and
  reflections.
- When the gym counter reaches the configured alert threshold in hours, the
  module's alert behaviors activate: colors carrying an `alertTheme`
  reference pulse toward the configured alert color, and `alertOnly` pulse
  layers appear, until the scraped counter drops below the threshold again.
- Arc size, angular velocity, direction, and easing respond to current load
  through each module's arcField parameters.
- Theme colors and opacities come from the resolved active dashboard theme's
  `avatar` field, resolved once per frame into the module palette — module
  switches never require re-picking colors.
- Each avatar arc color has a separate 0-100 opacity value that controls the
  alpha used for that arc's stroke and glow.
- Switching modules rebuilds the renderer and restarts the orb animation;
  editing theme colors does not.
- Dashboard scroll can scale the avatar.
- The canvas is decorative inside an accessible `Nova avatar` group.

Voice speaking behavior:

- When the voice agent starts speaking a response, nova-voice POSTs a
  speaking event to `POST /api/voice/speaking` (`phase: start|end`, `turnId`,
  optional consonant-onset `timingsMs`, `estimatedDurationMs`,
  `audibleOffsetMs`, `playedDurationMs`). The server fans it out to every
  connected browser as a `voice-speaking` event on the shared `/api/events`
  SSE stream; an in-progress start is replayed (with `elapsedMs`) to clients
  that connect mid-speech.
- On start, every client's status orb migrates to the viewport centre and
  enlarges (CSS transform transition; travel computed per client), and the
  gym-alert colour machinery pulses in time with the response's consonants:
  the consonant envelope replaces the module's alert oscillation via the
  renderer's `alertPulseOverride`. Without timings the fallback is the plain
  gym-alert pulse faded in fast at speech start and out at speech end.
- On end (or a client-side safety timeout if the end event never arrives) the
  pulse fades out and the orb migrates back to its resting position.
- Devices with the Status Orb feature toggled off still show the speaking
  orb: a speech-only host mounts centred for the duration of speech (opacity
  fade instead of migration) and unmounts afterwards, so opted-out devices
  pay no orb cost while the agent is quiet. Lite mode's instant-transition
  blanket rule applies to both journeys automatically.
- Config-preview orbs (`forceVisible`) never react to speech.

Gym counter behavior:

- The number of whole hours since the latest scraped GymMaster visit timestamp
  is centered over the avatar above the canvas.
- The digit is read-only; tapping/clicking it does not reset or mutate the
  counter.
- The browser polls `/api/watchface` every 5 minutes for the shared scraped
  timestamp and updates the readout at the next hour boundary.
- If no scraped timestamp exists, the widget displays 0 without initializing or
  writing a timestamp.
- The digit uses the same display font and heading font weight as dashboard
  headings, with dedicated configurable color and opacity.

Avatar settings:

- Stored in shared dashboard theme preferences as each variant's `avatar`
  field. `dashboard.avatar` remains as a legacy fallback for old installs and
  setup defaults.
- All Status Orb visual settings are part of the dark/light dashboard theme.
  Auto fullscreen is a per-device setting and is not part of any theme.
- Defaults include the `classic` orb module, a dark center/outer gradient,
  blue/purple/cyan line colors, a red gradient alert color, per-line opacity,
  and separate gym number color/opacity.
- Config page can edit the orb style (module selection), gradient center,
  gradient outer, gradient alert, line colors, per-line opacities, gym number
  color, gym number opacity, and the alert threshold in hours.

## 23. Status Orb Modules

The Status Orb's entire visual draw stack is data-driven. A "status orb
module" is a small, hand-editable JSON document that declares the orb's
layers — their count, shapes, sizes, proportions, draw order, colors, blend
modes, and animation parameters. The web dashboard renders modules with
canvas 2D today; the Apple TV dashboard implements the same interpretation
with Core Graphics (implementation to follow — the contract below is shared).
New orb looks are published by dropping a JSON file onto the host with no app
update on either platform.

Module sources and precedence:

- Built-in modules are compiled into the app in `lib/orb-modules.ts`:
  `classic` (Classic Glass — the faithful data-driven port of the original
  hand-coded orb), `reactor` (Reactor Core), `halo` (Halo), and `cross`
  (Cross — a flat diamond-framed X sigil whose activity display is status
  lines riding the X's bars). Built-ins guarantee the orb renders offline
  and before any fetch completes.
- Hot-droppable modules live as `*.json` files in `config/orb-modules/`
  (override the directory with the `NOVA_ORB_MODULES_DIR` env var). The
  shipped example is `aurora.json`; `config/orb-modules/README.md` documents
  the format for editors.
- `GET /api/orb-modules` returns built-ins overlaid with disk modules,
  merged by id. A disk file whose id matches a built-in replaces it, which is
  how a deployed host patches a built-in look in place.
- Invalid disk files are skipped and reported in the response's `errors`
  array (`{ file, error }`); they never break the module list or the orb.

Theme linkage:

- Each theme variant's `avatar.orbModule` field names the module that variant
  renders with, so dark and light themes can use different orb styles. The
  field defaults to `classic`, travels with theme import/export and the theme
  library like every other avatar field, and is normalized to `classic` when
  malformed. Well-formed but unknown ids are preserved (the module may exist
  on the host before a client has fetched it) and render as `classic` until
  they resolve.
- Modules define geometry and animation; the theme defines color. Every
  module references the same theme color slots, so switching modules never
  requires re-picking colors.

Module document format (`formatVersion` 1):

- Top-level fields: `formatVersion`, `id` (url/file-safe slug, ≤ 64 chars),
  `name` (picker label), `description` (picker detail line),
  `alertPulsePeriod` (seconds per gym-alert pulse cycle, default 1.2), and
  `layers` (ordered array, first layer at the bottom).
- Documents with a newer `formatVersion` than the renderer understands are
  rejected whole; unknown layer types inside a supported version are skipped
  individually (forward compatibility). A module with a bad id or no usable
  layers is rejected and the renderer falls back to `classic`.
- All normalization lives in `lib/orb-modules.ts` (`normalizeOrbModule`) and
  is applied by the server route, the web client, and the tests; clients
  re-normalize defensively after fetch.

Coordinate and angle conventions (the cross-platform contract):

- Unit space: orb radius = 1.0, orb center = (0, 0), +x right, +y down.
  Every length is a fraction of the orb radius, so a module renders
  identically at any pixel size. On the web the orb radius maps to
  `size * 0.48` of the avatar canvas, leaving margin for glow spill.
- Angles and sweeps are in turns (0..1 per revolution, clockwise from
  3 o'clock); angular speeds are turns/second. Renderers convert to native
  radians at draw time.

Color references:

- A layer color is `{ "theme": <slot> }` or `{ "hex": "#rgb|#rrggbb" }`
  (theme wins if both appear; invalid refs degrade to opaque white), plus
  optional `alpha` (0..1 multiplier) and optional `alertTheme` (a slot the
  resolved color mixes toward by the alert pulse while the gym alert is
  active — this is how the classic background throbs toward the alert color
  with zero module-specific renderer code).
- Theme slots: `gradientCenter`, `gradientOuter`, `gradientAlert`, `line1`,
  `line2`, `line3`, `gymNumber`, `innerShadow`. The host resolves slots into
  a per-frame palette (`buildOrbPalette`): line slots carry their per-line
  0-100 theme opacities as alpha, `gymNumber` carries its theme opacity, and
  `innerShadow` resolves to black at the theme's `innerShadowOpacity`.

Blend modes:

- `normal`, `additive`, `screen`, `multiply` — chosen because they map 1:1
  onto both canvas composite operations (`source-over`, `lighter`, `screen`,
  `multiply`) and tvOS `CGBlendMode` (`.normal`, `.plusLighter`, `.screen`,
  `.multiply`), so neither platform emulates blending.

Fields shared by every layer:

- `id` (optional editor label), `enabled` (default true), `blend` (default
  `normal`), `opacity` (0..1 layer multiplier), `clip` (confine the layer to
  the orb's unit disc so gradients/glows cannot spill past the rim), `glow`
  (soft glow radius as a fraction of the orb radius, drawn in the layer's own
  color), and `pulse` (`{ period, min, max, alertOnly? }` — multiplies layer
  opacity by a raised-cosine wave; with `alertOnly` the layer is hidden
  entirely until the gym alert activates, the building block for alert-flash
  layers).

Layer types:

- `disc`: filled circle/ellipse with a radial gradient. Fields: `center`,
  `radius`, `scaleY` (ellipse), `rotation` (turns), `stops`
  (`[{ at, color }]`; one stop = solid fill), and optional `gradientFrom` /
  `gradientTo` focus circles (`{ x, y, radius }`) for offset gradients —
  vignettes and "lit from above" falloffs. The gradient stays circular in
  unit space even for elliptical discs, matching the original cap highlight.
- `ring`: stroked full circle. Fields: `radius`, `width`, `color`.
- `arc`: stroked partial arc whose stroke is a linear gradient laid from the
  arc's start endpoint to its end endpoint so brightness tapers along the
  sweep. Fields: `radius`, `width`, `from`, `to`, `cap` (`round`/`butt`),
  `reverse` (flip the gradient direction), `stops`.
- `arcField`: the animated, load-reactive segment swarm. Fields: `count`,
  `radiusMin`/`radiusMax` (the radial band), `distribution` (`spread` =
  even spread with jitter, `rings` = snapped to `ringCount` concentric
  rings), `ringJitter`, `widthMin`/`widthMax`, `colors` (assigned per
  `colorMode`; defaults to the three line slots), `colorMode` (`cycle` =
  round-robin, the default; `random` = each segment picks a random entry at
  creation), `cap`, `idleSweepMin`/`idleSweepMax` (sweep range at zero
  load), `loadSweep` (sweep at full load), `speedMin`/`speedMax` (base
  angular speed range), `loadSpeed` (extra speed at full load),
  `sweepEase`/`velocityEase` (per-second easing rates),
  `resampleMin`/`resampleJitter` (seconds between target resamples).
- `line`: a single stroked straight segment. Fields: `from`/`to` (unit-space
  endpoints), `width`, `color`, `cap`. The building block for cross/sigil
  geometry such as the bars of an X.
- `polygon`: a stroked or filled polygon/polyline from explicit unit-space
  `points` (at least three; two-point shapes belong to `line`). Fields:
  `points`, `color`, `fill` (filled when true, otherwise stroked with
  `width`), `close` (set false for an open polyline, default true). Used for
  diamond frames, corner accents, and other straight-edged chrome.
- `lineField`: the linear counterpart to `arcField` — animated stroked
  segments riding back and forth along straight tracks. Fields: `count`,
  `tracks` (`[{ from, to }]` unit-space paths; segments are assigned
  round-robin, so two tracks split the population in half),
  `widthMin`/`widthMax`, `colors`/`colorMode` (as in arcField), `cap`,
  `idleLengthMin`/`idleLengthMax` (segment length range at zero load, as
  fractions of the track length), `loadLength` (length at full load),
  `speedMin`/`speedMax` (base travel speed range, track-lengths/second),
  `loadSpeed` (extra speed at full load), `lengthEase`/`velocityEase`,
  `resampleMin`/`resampleJitter`.

arcField motion model (identical on both platforms):

- Each segment keeps an angle, sweep, angular velocity, and a resample
  deadline. When the deadline passes, new targets are sampled: sweep =
  random idle sweep stretched toward `loadSweep` by the current load; speed =
  random base speed plus `load * loadSpeed`, with random direction. Sweep and
  velocity ease toward their targets each frame and the angle integrates the
  velocity. Segments are created with zeroed targets and an immediate
  resample so the first frame populates real targets.
- Segment radius, stroke width, and color assignment (per `colorMode`) are
  sampled once at renderer creation; switching modules rebuilds the renderer
  and restarts the animation, while theme color edits flow through the
  per-frame palette without touching animation state.

lineField motion model (identical on both platforms):

- Each segment keeps a track assignment, a center position `pos` (0..1 along
  the track), a length, a signed velocity (track-lengths/second), and a
  resample deadline. Resampling mirrors arcField: length = random idle
  length stretched toward `loadLength` by the current load; velocity =
  random base speed plus `load * loadSpeed` in a random direction (the
  "randomly reverse along the path" behavior). Length and velocity ease
  toward their targets each frame — all movement is lerped — and the
  position integrates the velocity.
- The segment spans `[pos - length/2, pos + length/2]` and must stay inside
  `[0, 1]`: hitting a track end reflects both the live and target velocity
  (a bounce), and a segment that outgrows its track pins centered. Initial
  positions are random so co-track segments are desynced from the start.
- Segments are distributed round-robin across `tracks` — the cross module
  uses two tracks along the X's bars, so half its status lines travel the
  top-left/bottom-right diagonal and half the top-right/bottom-left one.

Web implementation:

- `lib/orb-modules.ts`: types, normalization, color resolution
  (`resolveOrbColor`), built-in module definitions, and the
  `resolveOrbModule` fallback rule (requested id → fetched map → built-ins →
  `classic`). Shared by server and client; no React/DOM/fs imports.
- `lib/orb-modules-disk.ts`: server-only loader for the hot-drop directory.
- `app/api/orb-modules/route.ts`: the merge-and-serve route (no-store).
- `app/components/orbModules.ts`: client cache + `useOrbModules()` /
  `useOrbModule(id)` hooks (built-ins synchronously, host refresh on mount
  and every 5 minutes, fan-out via a window event) and `buildOrbPalette`.
- `app/components/orbRenderer.ts`: the canvas interpreter
  (`createOrbRenderer(module).render(ctx, frame)`); the frame carries center,
  radius in px, palette, load, alert state, and timing. The caller clears the
  canvas; the renderer isolates every layer in save/restore.
- `NovaAvatar` owns the canvas, the load polling/easing, the gym counter and
  alert threshold, and the per-frame palette; all drawing is delegated to the
  active module's renderer.

Apple TV implementation (`nova-appletv-dashboard/.../OrbModules.swift`):

- The tvOS client fetches `GET /api/orb-modules` from the dashboard host on
  its own 5-minute poll, decodes the same document shape leniently (clamped
  values, unknown layer types skipped, invalid documents rejected whole, a
  lossy module list so one bad host module never sinks the catalog), and
  merges the response over the compiled-in built-ins so a partial response
  can never remove the offline fallbacks.
- The built-ins are embedded as the exact JSON exported from
  `lib/orb-modules.ts` (`BUILTIN_ORB_MODULES`) and decoded through the same
  path as fetched modules, so both platforms agree on the documents
  byte-for-byte. Regenerate the embedded JSON when the web built-ins change
  (the regeneration command is commented next to the constant in
  OrbModules.swift).
- The shared theme decode carries `avatar.orbModule` into
  `DashboardAvatarTheme` with the same id validation and `classic` fallback;
  `DashboardStore.orbModule(id:)` applies the shared resolve rule
  (fetched map → built-ins → classic).
- `NovaAvatarOrb` delegates all drawing to the module interpreter
  (`drawOrbModule`) inside its SwiftUI `Canvas`: unit space maps onto the
  orb frame (radius = 0.48 × the view edge, matching the web convention),
  turns convert to radians at draw time, the four blend modes map onto
  `GraphicsContext` blend modes (`.normal`/`.plusLighter`/`.screen`/
  `.multiply`), `glow` renders as a shadow filter in the drawn color, and
  `clip` confines layers to the orb disc. The gym counter overlay, load
  polling, and listening load boost stay native.
- arcField/lineField animation state lives in `OrbAnimationModel` with the
  identical motion model (turns/track-fraction state, randomized resamples
  scaled by load, eased sweep/velocity, lineField end-bounce reflecting both
  live and target velocity); state rebuilds when the module value changes
  and is untouched by theme color edits.
- One documented approximation: SwiftUI `GraphicsContext` radial gradients
  are concentric, so a disc's offset focal gradients (`gradientFrom`/
  `gradientTo` with different centers, e.g. the classic bottom vignette)
  render centered on the from-circle — the same approximation the previous
  hand-coded tvOS orb used, visually indistinguishable at orb sizes.

## 24. API Contract

The Voice Infrastructure configuration includes a live `speakerRecognitionEnabled` switch
and an authenticated speaker-profile manager proxied to Iridium. Operators can inspect named,
pending, and provisional templates; edit names/pronouns; reassign or delete a template; and
delete a person with all associated templates. Biometric vectors never enter dashboard state
or browser responses.

All routes are under `app/api`.

Visualiser controls (the config panel formerly called Physics):

- The panel is built from two independent libraries. **Colour themes** are
  colours only. **Settings groups** are named sets of driver lanes plus the
  static settings a module cannot change without rebuilding its scene (today
  just `complexity`). Both are per module.
- A **colour theme group** joins them: an ordered playlist whose entries each
  pair one colour theme with one or more ordered settings groups. A theme may
  appear in several entries with different settings, so rotation advances
  through **entries**, not themes — two consecutive entries sharing a palette
  still cross-fade, because the behaviour differs.
- Where an entry names several settings groups, lanes stack and scalars layer:
  every group's lanes run at once, while a per-effect combine mode or a static
  setting collides and the later group wins.
- Exactly one settings group and one colour theme group carry the Default flag.
  The default group catches any genre that no group claims, and the default
  settings group catches an entry that names none. Neither can be deleted.
- Genres are assigned on the colour theme group and are exclusive across groups
  — assigning one steals it from whichever group held it, and the editor says so
  at the moment of assignment. The `chooseColorGroupByGenre` toggle that arms the
  routing sits outside the group list.
- Driver-lane semantics — driver types, `every`/`offset` gating, `divide`
  subdivision, modifier summation, envelopes, the four combine modes, and the
  overshoot guard — are specified in `PHONOSCOPE_MODULE_SPEC.md` §10 "Driver
  lanes" and shared by all three engines. `lib/phonoscope-drivers.ts` is the
  dashboard's copy.
- "When stacked" offers **Sum**, **Least frequent lane wins**, **Most frequent
  lane wins** and **Override**. The first two keep their original wire values
  (`add`, `strongest`) because saved configurations already hold them.
- The controls hierarchy is **four levels deep, not three**:

  ```
  Lane (Beat)
  └─ Effect (Centre image)
     ├─ Parameter group (Size)
     │  ├─ Parameter (Width)
     │  ├─ Parameter (Height + Auto)
     │  ├─ Parameter (Scale)
     │  ├─ Ramp            ← ONE, for the whole parameter group
     │  └─ When stacked    ← ONE, for the whole parameter group
     └─ Parameter group (Transition)
  ```

  An effect is one thing you add; inside it, related parameters live TOGETHER in
  a **parameter group**, not as siblings that happen to share a heading. A
  parameter group is a labelled block of controls, deliberately not a fourth
  accordion. The nesting is presentation only: each parameter is still its own
  effect id with its own binding, so both engines, the wire format and the
  conformance corpus are untouched and a settings group saved before groups
  existed renders under the new headings unmigrated.
- **A parameter group owns exactly ONE ramp. Every group, no exceptions.** The
  parameters of a group move together, so a ramp per parameter would be a
  control the user has to keep in sync by hand. The group's ramp is written to
  every member that can take one; a discrete axis, a toggle and a pinned value
  cut rather than ramp, so they are simply not part of it, and a parameter added
  to the group lands carrying the group's current ramp. It is not a property a
  group declares or opts into — a group that shows a ramp per parameter is a
  bug. The Glow group is the plainest case: opacity, blur, overdrive, blend mode
  and clamp are one parameter group under one ramp. The one place the ramp is
  not drawn by the group is the Transition group, whose control set draws the
  transition's own motion profile — which is that group's single ramp, not a
  second one.
- **A parameter group owns exactly ONE stacking mode ("When stacked"), on the
  same footing as its ramp.** How two lanes setting the group's value resolve
  against each other is a property of the thing being set, not of each slider,
  so it is offered once per parameter group and never per parameter. The chosen
  mode is written to every member that stacks — including members this lane has
  not added yet, so one added later already stacks the way the group does — and
  an override-only axis never stacks, so it is not part of it. `combine` is
  still keyed by effect id on the settings group, so the wire format is
  unchanged and the mode is still shared by every appearance of those
  parameters. An effect standing on its own in a lane, outside any group, keeps
  its own "When stacked" as an addable parameter.
- The **ramp** control has two readings, and the label says which is in play.
  On a pulse it is an envelope: attack rises, hold holds, release falls. On a
  one-shot transition it is a motion profile: attack is the ease-in, hold is the
  flat middle, release is the ease-out, and the transition lasts their sum.
- Not every slider is a range slider. A width and a height are ONE integer
  percentage of the screen on a single-thumb slider; the scale on top of them is
  the swept range worth binding to a lane. The centre image has no size-mode
  dropdown (it is always manual); the background image does, and its width and
  height only appear under Manual.
- The **Centre** effect group carries the transition alongside the height and
  scale, as **one control set rather than four effects**. Picking the mode
  (Cross-fade / Flip / Slide) decides what the rest of the set is: a flip adds
  the axis it collapses along, a slide adds the axis plus the division count and
  the return-edge toggle, and a cross-fade shows neither. The **ramp** is always
  shown, because every transition has one. The axis, divisions and return edge
  are never offered in the "Add effect" picker and never render on their own —
  the set writes them, and removing the transition removes them. Each is a
  single pinned value rather than a range, because they are latched for the
  length of the transition; all four are override-only, so the "When stacked"
  control is replaced by a line saying the last settings group wins. The entry a
  change *starts from* owns its transition — see `PHONOSCOPE_MODULE_SPEC.md`
  §10.
- A driver row asks "how often" once: a single cadence list running from
  "Eighth beat" through "Every one" to "Every 16th". Faster than the pulse there
  is nothing to start on, so the "Starting on" control is absent for a
  subdivided driver rather than shown inert.
- Nesting is `ConfigAccordion` throughout — settings group → driver lane →
  effect — so opening one closes its siblings at each level without any new
  state. Effects are collapsed by default and expose only the parameters that
  have been added; anything unset inherits the effect's declared default. An
  effect is *added* carrying the parameters that are its control, so it is never
  an empty row: its declared range plus an envelope, a checkbox pinned to its
  default for a toggle, a mode pinned to its default for a discrete axis, and
  the transition alone for a rotation pulse.
- Each entry in a colour theme group may name an **Alt theme** beneath its
  colour theme: a link to another theme in the same library, not a copy. The
  "Change to alt theme" effect (`__altTheme`) flips one household-wide state, so
  the whole system blends to whichever alt is available and the next firing
  blends back. Entries that name no alt keep their own colours and leave the
  state alone, which is what makes A → A-alt → B → C show C's alt. Editing the
  linked theme edits it everywhere it is used, and deleting it releases the link
  rather than leaving a dangling reference.
- **Solo** locks the visualiser to one colour theme and/or one settings group.
  It is persisted (`soloColorThemeId`, `soloSettingsGroupId`) and deliberately
  survives leaving the page, so a floating indicator in the top-right names what
  is held — colour theme above settings, 1px apart — and tapping it releases the
  lock. It is applied in `readPhonoscopeThemeState`, so it reaches the streamed
  renderer and the tvOS fallback at the same revision without either engine
  knowing the feature exists.
- Configurations written before this structure are migrated once on read by
  `lib/phonoscope-migrate-v3.ts`, which is behaviour-identical to the old
  baseline-plus-overrides cascade.

Preference history and restore:

- Every write to `data/dashboard-preferences.json` is recorded as a running
  diff in `data/history/preferences/`: `log.jsonl` holds one JSON Patch per
  revision, `genesis.json` the state the first revision changed away from, and
  periodic `checkpoint-*.json` snapshots bound how far a replay has to run.
  Recording happens inside the preferences write queue, after the save lands,
  and swallows its own failures — losing an undo point must never fail the save.
- **A revision is a minute, not a save.** Ten changes inside one minute are one
  revert point: the first write opens the bucket and every later write in that
  minute recomputes its patch against the state as the minute opened, so the
  entry always means "everything that happened during this minute". Saves that
  only restamp an `updatedAt` are not recorded at all.
- Any point in time is reconstructed by replaying from the nearest checkpoint,
  which is what lets the restore offer a branch that did *not* change at that
  moment. The API takes a `before` flag for the state a revision changed away
  from; the panel does not use it, because a single reading is clearer and
  nothing is lost — the state before a change is the state after the change
  preceding it, so recovering a deletion means restoring the row below it.
- `POST /api/preferences/history` restores the selected JSON pointers from a
  revision. A pointer absent at that revision is removed rather than skipped, so
  "put this back to how it was" can mean "it was not there" — which is why the
  restore writes through `replaceDashboardPreferences` rather than the merging
  path, since a merge cannot express a removal. The restore is itself recorded
  as a new revision and can be wound back in turn.
- The **History** panel leads System & Data. It lists revert points newest
  first, each with one **Restore** button meaning "the configuration as it stood
  once this minute's changes had been made". Choosing one shows the whole
  configuration as a tree of checkboxes: every branch is selectable, the ones
  that revision moved are dotted, and branches that are gone now or were added
  since say so.

Phonoscope track timing:

- `POST /api/phonoscope/tracks/resolve` accepts Apple Music track identity and
  returns Nova's complete cached analysis, including the canonical
  `beatTimes` array. Beat timing resolves in strict order: Spotify Audio
  Analysis when server credentials and endpoint access are available; a
  duration- and metadata-matched Songle recording; the household's optional
  Essentia service configured by `NOVA_PHONOSCOPE_ESSENTIA_URL`; and finally
  the existing ReccoBeats tempo materialised into a uniform beat grid. Spotify
  credentials are read only from `NOVA_SPOTIFY_CLIENT_ID` and
  `NOVA_SPOTIFY_CLIENT_SECRET`. Clients never contact any provider directly.
- The first resolution for a track is written atomically beneath
  `data/phonoscope/tracks`. Concurrent cache misses share one in-flight
  resolution, and subsequent resolutions are disk-cache reads, so a track
  cannot produce a provider request stampede. Lower-priority beat providers
  are not queried after a higher-priority provider returns a usable timeline.
- Older cached analyses are upgraded locally by materialising their BPM and
  beat offset into a version-2 beat timeline; this migration does not refetch
  upstream data. Manual BPM/offset overrides regenerate the cached timeline
  locally for the same reason.
- `GET /api/phonoscope/tracks/<trackKey>/beats` is the immutable Nova
  pass-through representation for other household clients. It serves only an
  existing Nova cache entry and never falls through to an upstream provider.
- House Party predicts lighting independently for local HA lights and
  cloud-backed Tuya lights. The tvOS source samples the shared beat timeline
  250 ms ahead for local devices and 1.10 s ahead for cloud devices; the
  dashboard applies those predicted brightness values through their respective
  service paths.
- House Party is gated by its own persisted master switch, with the hue and
  brightness modes nested under it in Visualiser controls.
- The random light-hue offset is the `__hueOffset` effect, bound to a driver lane
  like any other, ranging 0° through 180° with a default of 5°. Because the
  renderer is the only side that sees the spectrum, it resolves the effect and
  publishes the resulting magnitude on the House Party frame it already posts;
  the dashboard reads `hueOffsetDegrees` from the frame. Every affected light
  independently samples a continuous random offset from `[-magnitude, +magnitude]`
  for every House Party command; the rotation preserves the supplied colour's
  saturation and value. Per-entity HA calls are therefore intentional.
- The Apple TV publishes the authoritative track key, playback position,
  duration, play/pause state, and sample time with House Party frames.
  `GET /api/phonoscope/house-party/clock` advances that observation to server
  time. The web dashboard samples it every five seconds and corrects for half
  the measured round trip before publishing the resulting wall-clock/track
  offset in the `nova-house-party-clock-sync` window event. Other clients use
  the same endpoint and algorithm.

State and realtime:

- `GET /api/state`: build and return dashboard state, publish state event.
- `GET /api/events`: dashboard/task SSE stream. Alongside the `: keep-alive`
  comment (proxy idle protection) the server pushes a named `heartbeat` event on
  the same ~15s cadence; browser JS cannot see comment lines, so the client's
  shared-EventSource liveness watchdog uses heartbeat silence (>50s) to detect a
  half-open stream that still reports `readyState OPEN` and rebuild it.
- `GET /api/version`: return build ID and generated timestamp.

Camera:

- `GET /api/camera/<id>/status`: ensure the recorder is started and return the
  camera ID/name, source (`device` or `demo-clock`), recording state, ffmpeg and
  device availability, retention/segment lengths, oldest/newest segment times,
  and the latest recorder error.
- `GET /api/camera/<id>/index.m3u8`: ensure the recorder is started and return
  the live rolling HLS playlist. It may briefly return 503 while ffmpeg creates
  the first playlist.
- `GET /api/camera/<id>/seg_NNNNNN.ts`: return a path-sanitized HLS segment.
  Segments older than the retention allowance are refused.
- `GET /api/camera/outside/settings`: return persisted ffmpeg processing values.
- `PUT /api/camera/outside/settings`: validate and persist brightness, contrast,
  and sharpness, then restart only the outside recorder so the preview and live
  dashboard receive the new processing chain.
- `GET /api/camera/<id>/events`: list recent analysis events with limit,
  priority, zone, subject, reviewed, and starred filters.
- `GET|PUT|DELETE /api/camera/<id>/events/<event-id>`: inspect, review/star or
  correct, and explicitly remove an event. `/thumbnail` and `/clip` stream its
  media; clip responses preserve HTTP range semantics.
- `GET|PUT /api/camera/<id>/analysis`: read or replace the normalized scene
  polygons and analysis/alert switches. `/status` reports model, cursor,
  backlog, queue, errors, and storage health; `/frame` supplies the calibration
  editor background.
- `GET|POST|DELETE /api/camera/<id>/analysis/references`: manage private named
  cat and ute reference images used for tentative visual matching.

Control:

- `POST /api/zone`: body includes `zoneId`, `action`, optional
  `brightnessPct`, optional `rgb`, optional `cursor`, optional
  `sourceClientId`. Calls zone actions and returns updated state.
- `POST /api/entity`: body includes `entityId`, `domain`, `service`, optional
  `data`, optional `remember`, optional `sourceClientId`. Calls entity action
  and returns updated state.
- `GET /api/lights/toggle`: simple shortcut endpoint for indoor Home lighting.
  It chooses on/off from the current indoor lighting majority, uses the
  adaptive warm-white/candlelight preset when turning on, returns plain text
  `on` or `off`, and has a one-second cooldown.
- `GET /api/lights/on`: explicitly turn indoor Home lighting on using the
  adaptive warm-white/candlelight preset, returning plain text `on`.
- `GET /api/lights/off`: explicitly turn indoor Home lighting off, returning
  plain text `off`.
- `GET /api/outside-light/toggle`: simple shortcut endpoint for Outside zone
  lighting. It chooses on/off from the current outside lighting majority, sends
  plain power commands, returns plain text `on` or `off`, and has a separate
  one-second cooldown.
- `GET /api/outside-light/on`: explicitly turn Outside zone lighting on with
  plain power commands, returning plain text `on`.
- `GET /api/outside-light/off`: explicitly turn Outside zone lighting off,
  returning plain text `off`.

Telemetry:

- `GET /api/router`: return router status with no-store headers.
- `GET /api/power`: ensure power monitor is running, sample now, return power
  dashboard data with no-store headers.
- `GET /api/nova-load`: return host load metrics.

Configuration:

- `GET /api/config`: return config and setup status.
- `PUT /api/config`: validate and write config.
- `POST /api/config/validate`: dry-run validate config import.
- `GET /api/config/schema`: return JSON schema.
- `GET /api/config/setup-status`: return secret setup status.
- `GET /api/config/client`: return non-secret client config.
- `GET /api/orb-modules`: return every available status orb module — the
  compiled-in built-ins overlaid with normalized `config/orb-modules/*.json`
  files, merged by id (disk wins) — as `{ modules, errors }` with no-store
  caching. `errors` lists unreadable/invalid module files as
  `{ file, error }`. Consumed by both the web dashboard and the Apple TV
  client.
- `GET /api/theme`: return shared theme preferences as
  `{ selection, themes: { dark, light } }`. Legacy stored single-theme payloads
  are wrapped into both variants on read and normalized by clients. Missing
  `avatar` values and missing avatar fields are filled from the legacy
  `dashboard.avatar` fallback; present avatar color slots are preserved.
- `POST /api/theme`: write shared dashboard theme preferences. Namespaced
  `{ selection, themes }` payloads replace the stored theme set, while legacy
  single-theme partial payloads merge for compatibility. A legacy
  `autoFullscreenOnLoad` field is stripped recursively because fullscreen is a
  per-device setting that never lives in a theme. Writing a theme never pushes
  wallpapers to managed desktops.
- `POST /api/desktop/sync`: apply the current effective managed desktop
  wallpaper plan. The body's `force` flag selects the behaviour: `force: true`
  (the manual Apply button) bypasses the unchanged-wallpaper skip to repair
  machines that drifted manually, while the default deduplicated path (the
  automatic Back / dashboard-flip triggers) drops any target whose wallpaper
  already matches what was last applied, so the same image is never sent twice
  in a row.

Voice agent:

- `POST /api/voice/speaking`: nova-voice announces spoken-response start/end
  (`phase`, `turnId`, and on start the consonant `timingsMs`,
  `estimatedDurationMs`, `audibleOffsetMs`; on end `playedDurationMs`).
  Broadcast to every connected browser as the `voice-speaking` SSE event and
  replayed to clients that connect mid-speech (see Status Orb voice speaking
  behavior).

Climate controls:

- `POST /api/aircon/timer`: persist `aircon.offTimerEndsAt` as an ISO
  timestamp or clear it with `null`.
- `POST /api/panel-heater/timer`: persist `panelHeater.offTimerEndsAt` as an
  ISO timestamp or clear it with `null`.

Tasks:

- `GET /api/tasks?command=list`: list tasks.
- `GET /api/tasks?command=listen`: task-focused event stream compatibility.
- `GET /api/tasks?command=docs`: return task command docs.
- `POST /api/tasks?command=add`: add task.
- `POST /api/tasks?command=update`: update task.
- `POST /api/tasks?command=remove`: remove task.
- `PATCH /api/tasks`: update task.
- `DELETE /api/tasks`: remove task.
- `POST /api/tasks/bulk`: parse/import CSV tasks.
- `PATCH /api/tasks/[id]`: update task.
- `DELETE /api/tasks/[id]`: delete task.
- `POST /api/tasks/[id]/dismiss`: dismiss reminder alert only.
- `POST /api/tasks/[id]/chimed`: claim this occurrence's chime so no other
  screen and no later page load replays it.
- `POST /api/tasks/[id]/complete`: complete task.
- `GET /api/tasks/audio`: return reminder MP3 or status when `?status=1`.
- `POST /api/tasks/audio`: upload reminder MP3 using multipart form data.
- `DELETE /api/tasks/audio`: remove reminder audio.
- `GET /api/tasks/icloud-status`: return iCloud sync status.
- `POST /api/tasks/sync-icloud`: force iCloud sync.
- `ALL /api/tasks/mcp`: compatibility shim to `/api/mcp`.

Map/weather tiles:

- `GET /api/radar/[z]/[x]/[y]`: RainViewer radar tile proxy.
- `GET /api/satellite/[z]/[x]/[y]`: Esri satellite tile proxy.

MCP:

- `GET /api/mcp`: return MCP/server metadata.
- `POST /api/mcp`: JSON-RPC MCP endpoint.

System power:

- `POST /api/system/restart-stack`: queue a "restart everything short of a reboot"
  — what the System Power button uses. Writes a `restart-stack` request into the
  host control channel; the helper `docker restart`s Home Assistant and the other
  service containers, then bounces the dashboard last. Never self-exits (only the
  host helper can `docker restart` the other containers).
- `POST /api/system/restart-dashboard`: queue a dashboard-only restart. In
  production the route flushes a `{ queued, method: "self-exit" }` response and
  then calls `process.exit(0)` on the next tick; because the app is the sole
  process in the container the systemd unit launches with `Restart=always`,
  exiting relaunches a fresh container almost immediately, with no host helper or
  cron lag. In non-production it falls back to writing a `restart-dashboard`
  request into the host control channel so it never kills a dev server. Retained
  as a lower-level primitive; no longer wired to a UI button.
- `POST /api/system/reboot`: queue a host reboot by writing a `reboot-host`
  request into `data/system/control/`. A host-side helper performs the reboot;
  the containerised app never reboots the machine itself.

Miscellaneous:

- `GET /favicon.ico`: returns SVG icon content as `image/svg+xml`.

## 25. MCP and Agent Interface

`lib/mcp-dashboard.ts` implements the local MCP server contract.

Server:

- Name: `nova-dashboard`.
- Version: `1.0.0`.
- Endpoint: `/api/mcp`.
- Public metadata: `public/agent/nova-dashboard-mcp.json`.

Security:

- MCP can be enabled/disabled through config.
- Origins are checked against configured allowed origins.
- Requests without an Origin are allowed.
- Bearer auth is required when configured.
- If bearer auth is required and `NOVA_DASHBOARD_MCP_TOKEN` is missing, POST
  requests fail with service unavailable.
- Mutating tools require mutations to be enabled.
- When configured, mutating tools require `confirm: true`.

Supported JSON-RPC methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

Batch requests and notifications are supported.

Tools:

- `nova.config.get`
- `nova.config.export`
- `nova.config.schema`
- `nova.config.validate`
- `nova.config.apply`
- `nova.setup.status`
- `nova.dashboard.health`
- `nova.dashboard.state`
- `nova.ha.discover`
- `nova.zone.action`
- `nova.entity.action`
- `nova.tasks.list`
- `nova.tasks.listen`
- `nova.tasks.add`
- `nova.tasks.update`
- `nova.tasks.remove`

Resources:

- Current config.
- Config schema.
- Setup checklist.
- Home Assistant entities.

Prompts:

- Setup wizard.
- Config review.
- Deployment check.

Agent skill packaging:

- Source skill: `skills/nova-dashboard-management`.
- Public packaged copy: `public/agent/skills/nova-dashboard-management`.
- Packaging script validates skill frontmatter and referenced files.
- The skill instructs agents to inspect first, validate second, and mutate only
  after explicit confirmation.

## 26. Testing

Three layers cover the dashboard: Vitest unit/component tests, the dedicated
aircon Node test, and a Playwright end-to-end suite that drives the demo build.

### Unit and component tests (Vitest)

Unit tests are colocated `*.test.ts(x)` files next to the code they cover, run
with Vitest under jsdom. Notable suites include:

- `lib/aircon-control.test.ts` (via the dedicated Node runner, see below).
- `lib/camera/recorder.args.test.ts`, `recorder.pause.test.ts`,
  `update-pause.test.ts` — device argument shaping and the updater pause gate.
- `lib/router-metrics.test.ts` and `lib/modules/router/module.test.ts` —
  data-rate unit normalization, rate-entity selection, and router status.
- `lib/parse-task-csv.test.ts`, `lib/preferences.test.ts`,
  `lib/powershop-usage.test.ts`, `lib/icloud-config.test.ts`,
  `lib/config-scaffold.test.ts`, `lib/system-control.test.ts` — pure
  CSV/preferences/usage/config logic.
- `lib/orb-modules.test.ts` and `app/components/orbRenderer.test.ts` — orb
  module normalization and canvas rendering against a recording stub.
- `lib/dashboard-config.test.ts`, `lib/mcp-dashboard.test.ts`,
  `lib/state.golden.test.ts`, `lib/tasks.test.ts`,
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

## 27. Deployment and Operations

Primary deployment target:

- Host: the Nova box (hostname: see `PRIVATEREF.md#1.1`).
- Application directory: `/opt/nova-ha-dashboard`.
- Service: `nova-ha-dashboard.service`.
- Node runtime: Node 20 in the current recovered host setup.
- Home Assistant: local container on port `8123`.
- Matter server: port `5580`.
- Mosquitto: localhost port `1883`.
- CCTV capture: MacroSilicon MS210x / EasierCAP on Nova, exposed to the
  dashboard container through host `/dev` mounted read-only at `/host-dev` plus
  device-cgroup rule `c 81:* rwm` for V4L2 character devices.
- KDE Plasma dashboard browser: `~/.config/autostart/brave-nova.desktop`
  launches Snap Brave at `http://127.0.0.1/` with `--start-fullscreen`; this
  native browser/window-manager fullscreen is required so toolbar refreshes do
  not depend solely on DOM fullscreen permission. Loopback, not the host's
  mDNS name,
  is used deliberately: the dashboard container binds `--network host` on the
  same box, so the kiosk never needs mDNS at all, and self-referential
  mDNS lookups from Snap Brave were an unreliable source of
  persistent "Nova is unavailable" blocker states that other clients (which
  resolve the host's name across the LAN, not against themselves) never hit.

Operational expectations:

- `.env.local` on the deployed host must contain HA, MCP, iCloud, and
  Powershop secrets as needed.
- The dashboard expects network access to Home Assistant and internet access
  for weather/radar/satellite/Powershop/iCloud features where configured.
- If optional integrations are missing, the dashboard should degrade with setup
  status, warnings, or hidden/empty sections instead of crashing.
- The service's `/dev` bind and V4L2 cgroup rule are intentionally hot-plug
  safe: the container must still start when the capture adapter is absent, in
  which case the recorder selects the synthetic signal-test source.
- Production camera environment values in `.env.local` are:

```ini
NOVA_FFMPEG_PATH=/app/data/vendor/ffmpeg
NOVA_CAMERA_FONT=/app/data/vendor/DejaVuSans.ttf
NOVA_CAMERA_OUTSIDE_DEVICE=/host-dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0
NOVA_CAMERA_OUTSIDE_INPUT_FORMAT=v4l2
NOVA_CAMERA_OUTSIDE_PIXEL_FORMAT=mjpeg
NOVA_CAMERA_OUTSIDE_STANDARD=none
NOVA_CAMERA_OUTSIDE_FRAME_SIZE=720x480
NOVA_CAMERA_OUTSIDE_FRAME_RATE=25
NOVA_CAMERA_OUTSIDE_BRIGHTNESS=0
NOVA_CAMERA_OUTSIDE_CONTRAST=1
NOVA_CAMERA_OUTSIDE_SHARPNESS=0
```

- `ops/nova-ha-dashboard.service` is the checked-in service definition for this
  device access model. The installed host unit must remain aligned with it.
- The service resets V4L2 controls to hardware defaults before starting the
  container; persistent image tuning belongs in the ffmpeg environment values.
- To deliberately restore the generated signal test, unset
  `NOVA_CAMERA_OUTSIDE_DEVICE` and restart `nova-ha-dashboard`; do not remove the
  generator implementation.

Powershop scheduled scrape:

- Runner defaults to `/opt/nova-ha-dashboard`.
- Data defaults to `/opt/nova-ha-dashboard/data/power/powershop`.
- Log file defaults under `data/power/powershop/logs`.
- Docker image defaults to `mcr.microsoft.com/playwright:latest`.
- The scraper uses Playwright Chromium from that Docker image unless
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides it; it does not reuse the
  Brave kiosk browser that displays the dashboard.
- Cron is installed by `scripts/install-powershop-cron.sh`.

GymMaster scheduled scrape:

- Runner defaults to `/opt/nova-ha-dashboard`.
- Data defaults to `/opt/nova-ha-dashboard/data/gymmaster`.
- Log file defaults under `data/gymmaster/logs`.
- Docker image defaults to `mcr.microsoft.com/playwright:v1.60.0-jammy`, which
  matches the checked-in `playwright-core` version.
- Runtime credentials must be supplied as `GYMMASTER_EMAIL` and
  `GYMMASTER_PASSWORD` in `.env.local` on Nova.
- The runner mounts `/opt/nova-ha-dashboard/data` read/write so the script can
  fall back to updating dashboard preferences if the local dashboard API is
  unavailable.
- The production runner defaults `GYMMASTER_DASHBOARD_URL` to
  `http://127.0.0.1` because `nova-ha-dashboard.service` serves the dashboard
  on host port 80.
- Cron is installed by `scripts/install-gymmaster-cron.sh` with four entries:
  `0 3-19 * * *`, `*/15 20-23 * * *`, `*/15 0-1 * * *`, and `0 2 * * *`.

System power host helper:

- `ops/nova-system` drains `data/system/control/*.json` on a per-minute user cron
  installed by `ops/install-nova-system.sh` to `~/.local/bin/nova-system`,
  mirroring the self-updater's file control channel.
- `restart-stack` (the System Power button) `docker restart`s the service
  containers in `NOVA_STACK_CONTAINERS` then `docker stop`s the dashboard last —
  no sudo (the app owner is in the `docker` group).
- `restart-dashboard` is normally handled in-app by `process.exit(0)`; the
  helper's equivalent action (`docker stop nova-ha-dashboard`) is retained for
  manual CLI use.
- `reboot-host` runs `systemctl reboot`. The app owner has no interactive sudo,
  so reboot requires a one-time NOPASSWD rule in
  `/etc/sudoers.d/nova-system-reboot` for `systemctl reboot` / `reboot`, which
  `install-nova-system.sh --install-sudoers` installs. Without that rule the
  reboot request records a `failed` result in `data/system/state.json` and the
  host stays up.

## 28. Product Decisions From Prior Work

These decisions were recovered from project memory and are part of the intended
behavior unless explicitly changed:

- The dashboard is for the live Nova Home Assistant environment; Iridium never
  acts as a dashboard or Home Assistant environment.
- Nova is the only dashboard/HA host. Iridium is the dedicated Nova Voice
  inference host and is not an automatic dashboard fallback target. Voice
  preferences remain durable on Nova under `/api/voice`; a change sends Iridium
  a collection signal, and Iridium fetches and applies the complete contract.
- Non-voice/non-personality runtime controls live in a separate Agent accordion.
  The Agent contract is durable under `/api/agent` and is included when Iridium
  collects `/api/voice`. Its Ralph Wiggum verification loop is enabled by
  default and exposes a maximum state-check count, pause between checks, and
  wall-clock failure deadline. A smart-home mutation is sent once; only
  authoritative state reads repeat, stopping at whichever bound is reached first.
- Voice satellites are managed computers with the `voiceSatellite` capability;
  no machine is named in code. The config Voice Agent section lists each one
  with live status from Iridium's satellite registry (`/api/voice/satellites`)
  and a Reconnect button (`/api/voice/satellites/reconnect`) that restarts the
  satellite service on that host over the managed-computer SSH channel
  (macOS LaunchAgent kickstart with bootstrap fallback; Linux user service
  restart). The relaunched satellite reconnects to Iridium on its own.
- The Voice Infrastructure accordion opens with a system-wide voice killswitch
  ("Voice enabled"), a single master on/off written to the shared
  `systemVoiceEnabled` voice setting (POSTed to `/api/voice`, then pulled by
  Iridium). When off, Iridium drops every microphone frame and closes the open
  conversation, disabling voice for the whole household until it is turned back
  on; the default is on and only an explicit `false` disables it. This is the
  shared host-backed switch, distinct from the per-device browser voice-input
  toggle in Voice Agent config.
- Voice Infrastructure also exposes a shared Satellite noise gate switch. It
  defaults on and is part of the `/api/voice` contract as
  `satelliteNoiseGateEnabled`; Iridium pushes changes over the already-open
  native satellite sockets. Off is an explicit diagnostic bypass that makes
  each enabled native satellite transmit every captured 20 ms frame, while on
  keeps silence local and sends probable speech with protected pre-roll/tail.
- The per-satellite voice killswitch defaults Nocturnium off so a fresh/reset
  config processes only Indium. An explicit toggle can still enable Nocturnium
  or disable Indium without stopping either supervised process.
- The config page carries an always-visible voice-server status readout at the
  top: the dashboard probes Iridium's `/health` over mTLS via
  `/api/voice/server-status`, and the readout polls that endpoint every five
  seconds (skipping hidden tabs and never stacking overlapping probes). It
  shows the configured host name, overall state (online with latency,
  degraded, unreachable with the failure reason), and per-service dots for
  interpretation, speech to text, text to speech, the dashboard link, and the
  noise-suppression sidecar when reported. The readout is hidden in demo mode.
- Iridium posts accepted user speech and spoken replies to
  `/api/voice/transcript`. A standalone accordion on the main dashboard shows the bounded, live
  two-sided transcript; new lines share the dashboard SSE stream. The panel can be
  collapsed, and its Clear action erases the server snapshot and broadcasts
  the reset to every open dashboard. Voice Agent config does not contain the
  transcript display. Each entry renders as a two-line box decoration: a
  templated header line and a fixed `╰─ ` body lead-in before the message
  text. The header comes from the editable `transcriptTemplate` voice
  setting (Transcript decoration field at the bottom of Voice Agent config,
  with a live two-line preview; clearing the field restores the stock
  decoration, `╭─[ %u%%a% ➤ %d% %t% ➤ [%m%] ]`). Template tokens: `%u%`
  substitutes `USER` on user lines and empty on agent lines; `%a%` the
  upper-cased current agent name on agent lines and empty on user lines
  (speaker labels carry no emojis); unknown `%x%`-style tokens render
  literally. The remaining tokens: `%d%` is the locale-independent local
  date `2026-07-18 Sat`; `%t%` the minute-precision local time `10:59am`;
  and `%m%` the turn mode, reading `COMMAND` when the turn executed or
  shadowed a dashboard command and `EXCHANGE` otherwise (the voice server
  tags command turns, upgrading the displayed line in place once
  interpretation completes). Box glyphs and header share the meta
  styling — user prefixes render dimmed, agent prefixes in the highlight
  colour with a soft glow and an italicised body — so the two speakers are
  distinguishable at a glance. The log renders as a CRT screen: a scanline
  texture tinted by the transcript background colour (overlay-blended, with
  opacity and pitch scale sliders in the Transcript Background theme
  widget), a text glow (intensity and size sliders in the Transcript Text
  theme widget), and a static curved-glass gloss overlay inside a subtle
  bezel frame.
- The Outside camera normally uses the physical MacroSilicon S-Video capture
  feed; the generated signal test remains available as an explicit or
  device-absent fallback.
- The top-level Devices dashboard section was intentionally removed.
- Kitchen light 2 is expected to appear as `light.kitchen_light_2` under
  Kitchen and Everything when HA exposes it.
- Illumination-like switches belong in the lighting layer and in Everything.
- The outside light is excluded from broad inside/everything commands.
- Candlelight is adaptive by sun state: warm white by day, true candlelight by
  night.
- Adaptive lighting updates already-on lights at sunrise/sunset but does not
  turn lights on.
- White and custom color clear adaptive candlelight memory for a zone.
- Dashboard Auto aircon is app-managed thermostat behavior, not native Gree/HA
  auto.
- The aircon delta invariant must not be reversed.
- Dashboard UI controls and chrome should use the existing theme token system.
- Power graph colors may remain purpose-specific.
- Tasks include a read-only iCloud mirror and local editable task store.
- The Nova avatar is a host-load/status visualization mounted globally.

## 29. Known Constraints and Non-Goals

- The dashboard is optimized for a trusted local network deployment.
- Home Assistant token management is external to the app.
- Config files intentionally do not store secrets.
- iCloud mirrored tasks are read-only inside the dashboard.
- iCloud recurrence exception handling is limited by current implementation.
- The task CSV parser is a simple project-specific parser, not a full RFC CSV
  implementation.
- Power usage is an estimate when explicit power sensors are unavailable.
- Hardcoded Powershop rate tables need periodic review when plans/prices
  change.
- Radar and satellite features depend on external tile services.
- GPU load requires `nvidia-smi`; hosts without it report no GPU contribution.
- Linux `/proc` load readers are host-specific; non-Linux environments may
  return partial load data.

## 30. System Power Controls and Reconnect Blocker

The configuration page ends with a **System Power** section
(`SystemControlConfig`, rendered last in `ConfigWorkspace`) holding the two most
destructive actions in the UI, which is why they sit at the very bottom:

- **Restart Nova Services** — restart Home Assistant and the rest of Nova's
  service containers (MQTT, Matter, voice, bridges), then the dashboard itself —
  a "restart everything short of a reboot". The host computer stays on.
- **Reboot Nova** — reboot the whole host machine.

### Visual style

- Both buttons are rectangular "construction boxes": black filled with a
  highlight-colour tint, outlined in the highlight colour, with diagonal hazard
  hatching banded across the top and bottom edges. All colours derive from the
  live `--cyber-highlight` theme token, so the section follows the active theme.
- The styles are global (not scoped to `.dashboard-shell`), and the stripe
  decorations are child `<span>`s rather than pseudo-elements, so they survive
  the dashboard-shell's `.momentary-feedback` press-flash `::after` and its
  forced `position`/hover rules.

### Double confirmation

- Each action requires two confirmations. The first press opens a dialog
  ("Confirmation 1 of 2"); confirming opens a second ("Confirmation 2 of 2 —
  last chance"); confirming that fires the request. Both dialogs state plainly
  that the system will be unavailable.
- Dialogs render through a portal to `document.body` so they escape the
  `.zone-panel` `clip-path`, which otherwise establishes a containing block for
  `position: fixed` and clips the overlay to the panel. Tapping anywhere outside
  the box, or pressing Escape, dismisses it; it cannot be dismissed while a
  request is in flight.

### Restart Nova Services mechanism

- `POST /api/system/restart-stack` writes a `restart-stack` request into
  `data/system/control/` via `lib/system-control.ts`. It deliberately does **not**
  self-exit: bouncing Home Assistant and the other host containers needs
  `docker restart`, which only the host helper can do. The per-minute
  `ops/nova-system` cron drains the request and, in start-up dependency order,
  `docker restart`s each service container in `NOVA_STACK_CONTAINERS` (default
  `mosquitto matter-server homeassistant tuya-mobile-mqtt-bridge
  linux-voice-assistant`), then `docker stop`s the dashboard container last so
  the systemd unit's `Restart=always` relaunches a fresh one. Missing containers
  are skipped; a failure on any one is recorded but does not abort the rest. No
  host privilege is needed (the app owner is in the `docker` group).
- Because it goes through the cron channel, there is up to ~60 s of lag before the
  restart begins; the reconnect blocker covers the whole window.

- A lower-level `POST /api/system/restart-dashboard` still exists (production:
  flush then `process.exit(0)` ~300 ms later for a ~8 s self-relaunch; dev: file
  channel) and the `restart-dashboard` host action remains, but the System Power
  button now uses `restart-stack`.

### Reboot Nova mechanism

- `POST /api/system/reboot` writes a `reboot-host` request into
  `data/system/control/` via `lib/system-control.ts`, mirroring the
  self-updater's file channel. The host helper `ops/nova-system` (per-minute
  cron) drains it and runs `systemctl reboot`, gated by the NOPASSWD sudoers rule
  in §27. The containerised app never reboots the host directly.

### Reconnect blocker (every screen)

- After a confirmed restart or reboot, the dashboard shows an un-dismissable
  full-screen blocker: a 25%-black wash with a highlight-scheme spinner card in
  the same construction-box style (shared `SystemBlocker`, portaled to body).
- The initiating device (`SystemControlConfig`) shows it immediately, waits 5 s,
  then polls `/api/version` and navigates to `/` once Nova is reachable again. A
  reboot first waits to *see* Nova go offline (it keeps answering for a moment)
  before treating "reachable" as "back"; a 6-minute ceiling prevents a permanent
  trap.
- A global `SystemActivityBlocker`, mounted in `app/layout.tsx`, runs on **every**
  screen. It polls `/api/update` (which doubles as a reachability probe) and
  shows the same blocker whenever Nova is unreachable (restart/reboot) **or** an
  update is building or switching — automatic or manual — then reloads to the
  fresh build once Nova returns idle. So all displays block during a restart,
  reboot, or update, not just the device that triggered it.
- Robustness: entering the blocker from a clear state needs two consecutive
  failed polls (to ride out network blips); once blocking, a single miss keeps it
  up (the real restart window). A `phaseAt` staleness guard ignores a wedged
  "busy" update phase so a dead updater cannot trap every screen forever. A
  shared module flag (`systemBlockerState`) suppresses the global blocker on the
  initiating device so it never stacks two overlays. The blocker is disabled in
  demo mode.

### Host control channel and helper

- `data/system/control/<id>.json` carries `{ action: "restart-dashboard" |
  "restart-stack" | "reboot-host" }` from app to host; `data/system/state.json`
  records the last host action and result (for `restart-stack`, which services
  restarted / were skipped / failed) for observability.
- `ops/nova-system {process|restart-dashboard|restart-stack|reboot|status}`
  drains and acts;
  `ops/install-nova-system.sh` installs the binary, the per-minute cron, and —
  with `--install-sudoers` — the reboot sudoers rule.

## 31. Experience Modes (Rich vs Lite)

Older tablets cannot afford the dashboard's full visual load, so every device
tunes four independent heavy features: the **status orb**, the WebGL **fluid
background**, the live **camera** video, and the live maplibre **world map**
with radar. Each can be on or off per device. **Full Experience** turns all
four on (plus every CSS effect); **Lite** turns all four off and engages the
global CSS kill-switch for maximum performance; any mix in between is allowed.
See the Experience Mode Parity rule in §2: every new visual/costly feature
must declare its lite behavior.

### Storage model

- Per-device localStorage key `nova.dashboard.experienceMode.v1`, owned by
  `app/components/dashboard/experienceModeSetting.ts`
  (`readStoredExperienceFeatures`, `readExperienceFeatures`,
  `writeExperienceFeatures`, `setExperienceFeature`, `useExperienceFeatures`,
  `useExperienceFeature`, plus the legacy coarse helpers
  `readStoredExperienceMode`, `readExperienceModeSetting`,
  `writeExperienceModeSetting`, `useExperienceMode`, `useLiteMode`). Like auto
  fullscreen, it never travels with a theme and is never written to shared
  config.
- The stored value is backward-compatible: `"rich"` (all four on) and `"lite"`
  (all four off) are the canonical extremes and are still what the modal and
  seed helpers write; a mixed state serialises as a JSON
  `{statusOrb,background,camera,worldMap}` object. Missing object keys default
  to on.
- An absent or invalid key means the device is **undecided**: rendering
  resolves to all-on/rich (matching SSR) and the first-run chooser is shown.
- Writes toggle `data-nova-lite` (all four off) and `data-nova-no-orb` (status
  orb off) on `<html>` and dispatch the `nova-experience-mode-change`
  CustomEvent; hook instances also listen to native `storage` events for
  cross-tab sync.
- The head bootstrap in `app/layout.tsx` mirrors the key pre-paint, setting
  `data-nova-lite` and `data-nova-no-orb` before first paint so the CSS
  kill-switch and orb suppression apply from the first frame. The legacy
  `nova.dashboard.hideStatusOrb.v1` key is retired and deliberately ignored
  (product decision: every device is asked once instead of migrating).

### First-run chooser

- `app/components/ExperienceModeModal.tsx`, mounted in the root layout body so
  it covers every route. It renders nothing on the server and on the first
  client render; an effect reads the stored mode and reveals the dialog only
  when undecided (satisfying the §2 hydration rule, and guaranteeing decided
  devices never see a flash of it).
- Portal to `document.body` reusing the `system-confirm-*` styling;
  `role="alertdialog"`, focus moved to the primary button. There is **no**
  outside-click dismiss and no close button — a choice is required, otherwise
  "ask once" cannot be honoured. Buttons: "Lite" and "Full Experience"
  (primary). A hint line points at Config → This Device for changing it later.

### Config surface

- The `/config` "This Device" section (§21) exposes the four features as four
  `CheckboxRow`s: "Show Status Orb", "Show Background", "Show Camera", "Show
  World Map". Each toggles just its feature via `setExperienceFeature`, which
  also settles an undecided device, and applies live — no reload. The
  first-run modal's Lite/Full Experience buttons write all four at once.

### Behavior by feature (when its toggle is off)

- **Status orb** (§22): never mounted; no `/api/nova-load` or gym polling, no
  canvas loop. Pre-paint CSS hides the SSR markup (via `data-nova-lite` when
  fully lite, or `data-nova-no-orb` when only the orb is off). Gated on
  `useExperienceFeature("statusOrb")`.
- **Fluid background**: `Dashboard.tsx` does not mount `FluidBackground`; the
  `.dashboard-shell` static themed grid background remains, so the page is
  never unthemed. Gated on `useExperienceFeature("background")`.
- **World map**: `panel-registry.tsx`'s `WorldMapPanel` renders a static
  "Map Offline" placeholder instead of maplibre — no WebGL map, satellite
  tiles, or radar animation — and `useRadarPreload` skips both the radar tile
  preload interval and the maplibre module preload. Both gated on
  `useExperienceFeature("worldMap")`.
- **Camera**: `OutsideControls` does not mount `CameraPanel` (no hls.js, no
  video decode). Gated on `useExperienceFeature("camera")`.
- **Dot controls**: the remote-easing rAF loops in `DotControls.tsx` are
  skipped when the device is in full lite (all four off, `useLiteMode()`);
  values snap to target.
- **Visualiser controls**: no gate is needed. The panel is markup plus
  `ConfigAccordion`, `ConfigSelect` and the `DotControls` wrappers, so it
  inherits their lite behaviour — its sliders snap and its accordions open
  instantly. It runs no timers, no canvas and no stream of its own; driver lanes
  are evaluated by the renderer, not by the editor.
- **Scrolling**: native/instant on every device. The former smooth-scroll
  feature — the CSS `scroll-behavior: smooth` default plus the JS wheel-momentum
  engine (`useSmoothWheelScroll`) and its per-device "Smooth Scrolling" toggle
  and speed slider — was removed. Page-level jumps (anchor/hash, keys,
  programmatic `scrollTo`) now land instantly, so reload scroll-restore
  (`useScrollRestore.ts`, `ConfigWorkspace.tsx`) no longer needs to fight a
  smooth default.
- **Click-and-drag scroll**: `useClickDragScroll` (mounted via
  `SmoothScrollController`) lets **mouse** users press anywhere and drag to pan
  the window scroll on both the dashboard and `/config`, mirroring the native
  touch drag — touch is left untouched (mouse events only). A 5px movement
  threshold keeps ordinary clicks working (buttons/links still activate; a real
  drag suppresses the trailing click and any native link/image drag). Form
  fields, `[role="slider"]`, contenteditable, the maplibre map, inner scroll
  regions, and `data-nova-no-drag-scroll` opt-outs are skipped. It is a direct
  1:1 input (no easing/animation), so it is not gated by lite or reduced-motion.
- **Reminder icon bar** (§19): renders identically — the tiles, their
  dim/lit opacity, and tap-to-complete are all unaffected. Only the overdue
  glow pulse stops animating, holding its first keyframe (no glow, still full
  opacity, still the alert colour). No gate is needed: the animation is plain
  CSS, and the component adds no timers or streams of its own.
- **Task glow**: the inset blur stacks are flattened via CSS overrides on the
  consuming rules (the `--task-glow-*` vars are inline styles on `<html>`, so
  the vars themselves cannot be overridden from a stylesheet).
- **All CSS animations/transitions/backdrop-filters**: neutralised wholesale
  by the kill-switch below.

### CSS kill-switch contract

- `app/globals.css` carries a `html[data-nova-lite] *` blanket rule setting
  `animation-duration: 0.01ms`, `animation-iteration-count: 1`,
  `transition-duration: 0.01ms`, and `backdrop-filter: none` (all
  `!important`). Near-zero durations — not `animation: none` — so fill-mode
  reveals still complete instantly and land on their end state.
- `.animate-spin` is exempted: busy spinners are functional feedback, not
  decoration.
- `box-shadow` is deliberately not blanket-killed (panel borders depend on
  it); only the task-glow stacks are flattened individually.
- `app/liteMode.contract.test.ts` greps these contracts in source and fails
  with a pointer here if they are refactored away.
