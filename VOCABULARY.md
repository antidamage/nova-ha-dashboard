<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Vocabulary — the words, and which area answers them

[ARCHITECTURE.md](ARCHITECTURE.md) says where code lives. [specs/README.md](specs/README.md)
says what each area does. This file says what the **words** mean, which **area**
owns the thing being asked for, and where a change of each kind goes.

Read it before exploring. Most of the wasted work in an agent task is
re-deriving "which of the seven things called a module does she mean" from the
tree instead of from a list.

Every path in this file is relative to the repo root, so a path can be opened
without guessing what it is relative to — the one exception is `PRIVATEREF.md`,
which is git-ignored and so is present only in a checkout that has it. A path in
`<angle brackets>` is a shape, not a file.

The worked example, because it is the one that keeps going wrong: **"read the
air conditioner code in the module"** is `lib/aircon-control/` and
`lib/climate-control/` — the server thermostat that decides when the unit runs.
It is *not* `app/components/dashboard/climate/` (the card and its knob bindings)
and *not* `lib/modules/climate/` (a capability module that reports whether the
home has climate entities). "The X module" in passing means the code that
MANAGES X, not the surface that shows X.

## 1. Words that mean more than one thing

| Word | The meanings, likeliest first | Where each one lives |
|---|---|---|
| **module** | (1) the code that manages a feature — "the aircon module", "the voice module" → `lib/<area>/` (see §2); (2) a **device type**: a *control* module ("Air Conditioner / Heater", "Room Lighting") or a *driver* module ("Gree Air Conditioner") → `lib/control-modules/modules.ts`, listed in the config page's Devices tab; (3) an **installable module** — real code, dropped in at runtime → `lib/modules/runtime/`, `data/modules/<id>/`; (4) a **capability module** — server data only, no installed code → `lib/modules/<id>/module.ts` + `lib/modules/registry.ts`; (5) a **status orb module** — JSON describing the orb's layers → `lib/orb-modules.ts`, `lib/orb-modules-disk.ts`, `config/orb-modules/`; (6) a **Phonoscope module** — the visualiser format → `PHONOSCOPE_MODULE_SPEC.md`; (7) a repo named `nova-module-*` (the Discord bot) | `specs/control-modules.md`, `specs/module-system.md`, `specs/status-orb-stack.md` |
| **card** | (1) a dashboard card, one `ControlCard` in a zone's controls → `app/components/dashboard/`; (2) what a *preset* draws — a preset's `name` is the card's title; (3) a config-page section — that surface is built from accordions, not cards | `app/components/dashboard/ControlCard.tsx`, `lib/control-modules/`, `app/components/config/` |
| **panel** | (1) a **zone panel** — a whole-zone page: Grid, Network, Climate, Outside, World, Voice → `app/components/dashboard/panel-registry.tsx`; (2) a **slot surface** — where slots live: `quick-access`, `clock`, `reminders`, `zones`, `zone-panel`, `tasks` → `lib/control-modules/types.ts` (`CONTROL_SLOT_SURFACES`). `lib/control-modules/panel-surfaces.ts` is the narrower list of five panels that hold their own content as a `panel-content` preset — every surface above except Quick Access | `specs/control-modules.md` |
| **slot** | a place on a panel that holds a preset. A reference, never a copy. Not a layout cell. A **line slot** ("a wide slot at the bottom") is the full-width one-line slot a panel that groups its slots gives every module that is not a dial; it collapses when nothing is placed in it | `lib/control-modules/slots.ts`, `app/components/dashboard/panel-slots/`, `app/components/dashboard/panelSlots.ts` |
| **grid** | (1) **the Grid** — the power/metering page (`POWER_ZONE`, name "Grid"): the meters, the washing machine, the amp. "the grid page" means this; (2) the **slot grid** — the layout maths that arranges slots on a panel; (3) the visualiser's `grid` effect group | `app/components/dashboard/power/`, `app/components/dashboard/panelSlots.ts`, `app/components/dashboard/quick-access/slot-layout.ts` and `app/components/dashboard/panel-slots/slotGrid.ts`, `lib/phonoscope-effect-groups.ts` |
| **zone** | a room or grouping: every Home Assistant area, plus Home/"everything" (the aggregate) and the synthetic zones Grid (power), Reminders (tasks), World, Voice | `lib/ha/zones.ts`, `app/components/dashboard/shell/constants.ts`, `app/components/dashboard/ZonesPanel.tsx` |
| **mode** | (1) **experience mode** — Rich or Lite → `specs/experience-modes.md`; (2) **climate mode** — Auto / Manual / Off, the *server thermostat's* selection, versus **hvac mode** — heat / cool / dry / fan_only, the *unit's* direction; (3) **theme variant** — light or dark; (4) **knob theme** — Light / Auto / Dark | `lib/climate-control/mode-model.ts`, `lib/aircon-control/mode-model.ts`, `app/components/accentColor.ts` |
| **theme** | the colour theme (a saved library item) vs **design** (the presentation layer: Nova Classic, Plain) vs the light/dark **variant**. Design and theme are independent axes | `specs/theme-and-configuration-ux.md`, `specs/design-modules.md` |
| **orb** | (1) the **status orb** — what it shows (`lib/orb-info/`) and how it is drawn (`lib/orb-modules*.ts`); (2) the Nova **avatar** orb at the body level, which shows host load; (3) a knob's face, drawn by `RotaryEncoder` | `specs/status-orb-stack.md`, `specs/nova-avatar.md` |
| **dial / knob / encoder** | one thing: the rotary control every Nova knob is built on, `RotaryEncoder`, and its climate, colour and timer children. Geometry is separate from behaviour | `app/components/RotaryEncoder.tsx` and `app/components/controls/rotary/`, `specs/color-encoder.md`, `specs/temperature-encoder.md` |
| **reminders / tasks** | the same thing. The data is tasks; the zone is named "Reminders"; the panel is `TasksPanel`; the icon bar is `ReminderIconBar` | `lib/tasks/`, `app/components/tasks/`, `app/components/reminders/`, `app/components/dashboard/ReminderIconBar.tsx` |
| **lights** | (1) a zone's lights, which include the `switch` entities the classification calls illumination — "the lights" is not the `light` domain alone; (2) **all lights** — the whole-house command, not a zone's | `lib/ha/lighting/`, `lib/entity-semantics.ts`, `lib/ha/zones.ts`, `app/api/all-lights/` |
| **house party** | the whole house's lights following one theme and clock, across clients | `lib/house-party.ts`, `lib/house-party-coordinator.ts`, `app/components/dashboard/useHouseParty*.ts` |
| **advanced fold** | a panel's default view plus the rest behind the sunken divider; a **sub-panel** is one independently scrolling area inside it | `app/components/dashboard/AdvancedFold.tsx`, `app/components/dashboard/advanced-fold/`, `specs/advanced-fold.md` |
| **companion** | the companion app on a managed computer (presence, status, wallpapers) — and the config folder for it | `lib/managed-computers/`, `app/components/companion/`, `app/components/config/computers/` |
| **kiosk** | a wall tablet: its identity, its activity and its display rotation | `lib/kiosk-witness/`, `ops/kiosk/`, `app/components/config/face/`, `app/components/KioskActivityConfig.tsx` |
| **the site / the dashboard** | the running build on the host. The host, its address and how to reach it: `PRIVATEREF.md`. The repo runs its own dev server; a change is live only once it is merged and the host applies an update. To see it without the host: `npm run dev`, or the Playwright suites, which run against the demo build | `specs/deployment-and-operations.md`, `ops/nova-release`, `specs/self-update-channel.md`, `playwright.config.ts`, `e2e/` |

## 2. Areas — what owns it, and where the code is

`Code` is the server and shared logic; `Surface` is what the owner sees. The
`Spec` column is the behaviour authority; most are `specs/*.md` and
`specs/README.md` indexes them all, but a few areas keep theirs elsewhere — the
row says where.

| Area | Code | Surface | Spec |
|---|---|---|---|
| Lighting, zones, presets | `lib/ha/lighting/`, `lib/lighting-*.ts`, `lib/zone-light-rules/`, `lib/ha/zones.ts` | `app/components/dashboard/ZoneControls.tsx`, `app/components/dashboard/zones/`, `app/components/dashboard/ZoneLightEvents.tsx` | `specs/lighting-and-zone-control.md`, `specs/zone-light-events.md` |
| Climate: the thermostat authority | `lib/aircon-control/`, `lib/climate-control/`, `lib/climate-control-policy.ts`, `lib/bedroom-heater-control/`, `lib/climate-instances.ts` | `app/components/dashboard/climate/`, `app/components/dashboard/ClimateControls.tsx`, `app/components/dashboard/ClimateKnobs.tsx` | `specs/aircon-auto-control.md`, `specs/climate-controls.md`, `specs/bedroom-heater-control-integrity.md` |
| Power, the Grid, meters | `lib/power/`, `lib/power-meter-guard.ts`, `lib/powershop-usage.ts`, `lib/amp-*.ts`, `lib/power-floating-meter.ts` | `app/components/dashboard/power/`, `app/components/dashboard/PowerPanel.tsx`, `app/components/dashboard/usePowerDashboard.ts` | `specs/power-meters.md`, `specs/amp-appletv-power.md` |
| Washing machine | `lib/washing-machine/`, `lib/wash-*.ts` | `app/components/dashboard/power/washing-machine/` | `specs/power-meters.md` |
| Media: the amplifier and the Apple TV | `lib/amp-*.ts` (the amp's power control and the meter it follows), `lib/apple-tv/`, `lib/appletv-command.ts`, `lib/appletv-swipe.ts` | `app/components/dashboard/appleTV*.tsx`, `app/components/dashboard/appleTVAmpClient.ts`, `app/components/dashboard/appleTVAmpCommands.ts` | `specs/apple-tv-volume.md`, `specs/amp-appletv-power.md`, `specs/appletv-audio-outputs.md` |
| Tasks and reminders | `lib/tasks/`, `lib/tasks.ts`, `lib/icloud-sync/` | `app/components/TasksPanel.tsx`, `app/components/tasks/`, `app/components/reminders/`, `app/components/dashboard/ReminderIconBar.tsx` | `specs/tasks-panel.md`, `specs/icloud-sync.md` |
| Camera and DVR | `lib/camera/`, `camera-events/` (python), `app/api/camera-proxy/` | `app/components/dashboard/CameraPanel.tsx`, `app/components/dashboard/camera/`, `app/components/config/camera/` | `docs/camera-dvr.md` |
| Outside, weather, map, radar | `lib/modules/weather/`, `lib/radar/` | `app/components/dashboard/OutsideControls.tsx`, `app/components/dashboard/WeatherPanel.tsx`, `app/components/MapPanel.tsx` | `specs/outside-weather-and-map.md` |
| Network and router | `lib/modules/router/` | `app/components/dashboard/RouterPanel.tsx` | `specs/router-and-network-panel.md` |
| Voice and satellites | `lib/voice-*.ts`, `lib/voice-settings/`, `lib/voice-host-settings/`, `lib/nvaf.ts` (the browser satellite's audio frame, byte-pinned to nova-voice's `protocol.py`) — the voice server itself is the **nova-voice** repo | `app/components/dashboard/VoicePanel.tsx`, `app/components/VoiceConfig.tsx`, `app/components/dashboard/BrowserVoiceSatellite.tsx`, `app/components/dashboard/satellite/` | nova-voice's own specs |
| Visualiser (Phonoscope) | `lib/phonoscope*.ts`, `lib/phonoscope-*/` | `app/components/phonoscope/`, `app/components/PhonoscopeConfig.tsx` | `PHONOSCOPE_MODULE_SPEC.md` at the repo root |
| Status orb | `lib/orb-info/`, `lib/orb-modules*.ts`, `lib/orb-timer*.ts` | `app/components/orb-info/`, `app/components/orbRenderer.ts`, `app/components/orbModules.ts` | `specs/status-orb-stack.md` |
| Avatar, host load, gym counter, watchface | `app/api/nova-load/route.ts`, `scripts/gymmaster-attendance-scrape.mjs`, `lib/watchface-preferences.ts` | `app/components/NovaAvatar.tsx`, `app/components/avatar/`, `app/components/WaveshareWatchfaceConfig.tsx` | `specs/nova-avatar.md` |
| Home Assistant client, state, events | `lib/ha.ts` + `lib/ha/`, `lib/state.ts`, `lib/dashboard-events/` | `app/components/dashboard/state/` | `specs/home-assistant-integration.md`, `specs/api-contract.md` |
| Config, persistence, preferences | `lib/config-schema/`, `lib/dashboard-config/`, `lib/preferences/` | `app/components/config/`, `app/components/ConfigWorkspace.tsx` | `specs/configuration-model.md` |
| Theme, design, wallpaper, sounds | `lib/theme-*.ts`, `lib/design-preferences.ts`, `lib/wallpaper-*.ts`, `lib/sound-*.ts` | `app/components/accentColor.ts`, `app/components/AccentConfig.tsx`, `app/design/`, `app/designs/` | `specs/theme-and-configuration-ux.md`, `specs/design-modules.md`, `specs/ux-sounds.md` |
| Shared controls library | — (front-end only) | `app/components/controls/`, `app/components/RotaryEncoder.tsx`, `app/components/ColorEncoder.tsx`, `app/components/ConfigSelect.tsx`, `app/components/SlideSwitch.tsx` | `docs/control-inventory.md` is the inventory; `specs/ux-system9-controls.md` |
| Control modules: presets and slots | `lib/control-modules/` | `app/components/config/devices/`, `app/components/dashboard/panel-slots/`, `app/components/dashboard/quick-access/` | `specs/control-modules.md` |
| Installable modules | `lib/modules/runtime/` | `app/components/modules/` | `specs/module-system.md` |
| Login, face auth, witnesses | `lib/authentik-flow/`, `lib/kiosk-witness/`, `face-auth/` (python) | `app/components/auth/`, `app/components/face/` | `specs/login-surface.md`, `specs/face-auth.md`, `specs/kiosk-attribution.md` |
| System power, desktops, sleeping | `lib/system-control.ts`, `lib/desktop-sleep.ts`, `lib/desktop-wake.ts`, `lib/managed-computers/` | `app/components/dashboard/DesktopSleepPanel.tsx`, `app/components/config/computers/` | `specs/system-power-controls.md` |
| Doorbell | `lib/doorbell/`, `lib/doorbell-coordinator.ts` — server side only, driven by a call to the sequence route rather than by any dashboard control | `app/api/doorbell/sequence` | no spec of its own yet |
| MCP and the agent interface | `lib/mcp/`, `lib/mcp-dashboard/` | — (no dashboard surface) | `specs/mcp-and-agent-interface.md` |
| Update channel | `lib/update/`, `lib/update-scheduler.ts` | `app/components/UpdateBanner.tsx`, `app/components/config/updates/` | `specs/self-update-channel.md` |
| Arrival and departure | `lib/arrivals/` (member-model, apply-model, targets.ts and lib/arrivals/targets/), `lib/config-schema/arrivals.ts` | `app/components/config/arrival/` (the section under Voice & People → User Data) | `specs/arrival-and-departure.md` |
| Events, attribution, monitoring spool | `lib/event-spool.ts`, `lib/control-attribution.ts`, `lib/request-attribution.ts`, `lib/household-events/` | `app/components/dashboard/useDashboardCommands.ts` | `docs/household-event-feed.md` |

## 3. Where a change goes

| The change | Goes in |
|---|---|
| Behaviour, state, a device command | `lib/<area>/` — the area's row above. A package keeps a thin facade at the old path (`lib/aircon-control.ts` over `lib/aircon-control/`) |
| Front-end, a control, a layout | `app/components/<area>/`; shared controls in `app/components/controls/` and `app/components/*.tsx`. Reuse the component named in `docs/control-inventory.md` before writing one |
| Styling, layout, orientation | the partial for the area under `app/styles/`; `app/globals.css` is only the entry file that imports them in load-bearing order. Per-orientation layout: `specs/landscape-layout.md`, `specs/portrait-layout.md`, `specs/ui-shell.md`. Read the `app/globals.css` trap in `ARCHITECTURE.md` first |
| A new HTTP route | `app/api/<name>/route.ts` (route-per-directory), then `specs/api-contract.md` |
| A device type on the dashboard (control or driver module) | the `CONTROL_MODULES` array in `lib/control-modules/modules.ts`; `catalogue.ts` holds the lookups over it. What a module may declare comes from `lib/control-modules/fields.ts`, `features.ts`, `types.ts`; a new *renderer* is product code in `app/components/` |
| A capability module | `lib/modules/<id>/module.ts`, register in `lib/modules/registry.ts`, config block in `lib/config-schema.ts`, generic defaults in `config/dashboard-config.default.json`, then `lib/fresh-install.test.ts` must pass. Worked examples: `docs/module-examples/` |
| An installable module (real code, not data) | its own package directory (`module.json`, `server.mjs`, `client.mjs`) — it lives in `data/modules/<id>/`, not in this tree. Format and rules: `specs/module-system.md` §1 |
| A Phonoscope module or the module format | `PHONOSCOPE_MODULE_SPEC.md`, the conformance corpus in **nova-visualiser**, and both renderers |
| An owner-visible setting | the config page: `app/components/config/<category>/`. Categories and their accordions are in `app/components/configStaticTree.ts` |
| A value that describes *this house* (entity ids, room names, account details, titles) | never source. `config/dashboard-config.default.json` holds generic defaults; this home's real values live in the **nova-household** package and in `data/`. Enforced by `lib/no-household-data.test.ts` |
| The numbers a rule turns on (thresholds, timeouts) | `lib/<area>/constants.ts`, surfaced to config where the owner sets them |
| A test | unit tests are colocated (`<name>.test.ts(x)`), fixtures in `test/`, end-to-end in `e2e/` (Playwright) |
| Deployment, kiosk, host services | `ops/`, and the workspace-root `deploy-*.ps1`. The dashboard is not deployed by a script: the host applies an update |
| The voice server, satellites, wake word | the **nova-voice** repo |
| The Apple TV app | the **nova-appletv-dashboard** repo (its CI builds and deploys it) |
| The GPU visualiser renderer | the **nova-visualiser** repo |
| The Discord bot | the **nova-module-discord** repo |

A change that alters behaviour, an API, configuration, persistence, tests or
visible UI updates the matching spec in the same change — that is the repo's
rule, not this file's.

### The config page, by category

| Category | Holds |
|---|---|
| Assistant | identity, agent, authority |
| Voice & People | voice infrastructure, voice, voice training, user data (face enrolment, kiosk activity, arrival & departure — the household member list and what each member's arrival and departure set) |
| Appearance & Dashboard | appearance (theme settings: colours, fonts, status orb, background, map, theme reminders, sound), reminders, status orb info, climate, Apple TV swipe, Phonoscope |
| Devices | managed computers, hardware assistant, camera, **Controls & Devices** (device types, their presets, and the panel slot lists) |
| Modules | installed installable modules, and the device-module library (download/install a package) |
| System & Data | history, secrets, config transfer, updates, system power |

## 4. Keeping this current

This file is only worth reading if it is true. Every agent working in this repo
is asked to keep it that way:

- **A change that adds, renames or retires an area, a panel or slot surface, a
  kind of module, a config section, or a word the owner uses for one of them
  edits this file in the same PR.**
- **If you had to spend more than a couple of reads to find something, add the
  term here** — that is the whole reason this file exists.

Owner sessions are the richest source: when the owner names something and the
agent hesitated, the term and its answer belong in §1 or §2.
