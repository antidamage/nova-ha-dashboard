# Nova avatar and host load

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
  theme's `avatar.orbModule` field (see `specs/status-orb-stack.md`, "Status Orb Modules", for
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

Status orb readout (info modules):

- The readout centered over the avatar is produced by a selectable **status orb
  info module**. The orb itself knows nothing about gyms, processors or
  thermometers: it asks the selected module for its output and renders whatever
  that module's display configuration formats it into.
- **Module output** is the contract (`lib/orb-info/types.ts`): a `value` in the
  module's `baseUnit` (or `null` when there is genuinely no reading), optional
  pre-rendered `text` for word readouts, `observedAt`, a `status` of
  `ok | stale | unavailable | error`, an `alert` flag that drives the orb's
  alert pulse, and an `alertThreshold` in base units so a percentage display has
  a basis.
- A `null` value renders the configured `emptyText` (default `—`) and never
  raises the alert pulse. It is never shown as `0`.
- **Display configuration** is per module (`OrbInfoDisplay`): `format`
  (`number | duration | percent | clock | temperature | text`), `unit`
  (auto/seconds/minutes/hours/days/weeks, celsius/fahrenheit, watts/kilowatts),
  `decimals` 0-3, `rounding` (`floor | round | ceil`), percentage basis
  (`moduleThreshold` — the percentage until a threshold has been met — or a
  fixed value) with clamp and count-down options, unit symbol, sign, 12-hour and
  seconds for clocks, and prefix/suffix/emptyText.
- `formatOrbValue` (`lib/orb-info/format.ts`) is pure and shared: the Apple TV
  runs a Swift port of it, and both are held to the conformance table at
  `lib/orb-info/format-cases.json`.
- The orb re-renders when the FORMATTED text would next change
  (`msUntilDisplayChange`), not on a fixed timer — an hours counter at one
  decimal place updates every six minutes rather than hourly.
- Each module declares its sources; the orb subscribes to exactly those. `none`
  and `clock` start no network traffic at all. Host modules are fed by the orb's
  existing 2-second `/api/nova-load` poll rather than a second one, and the
  sample is stored only when the displayed value would change.
- The catalogue (`lib/orb-info/catalogue.ts`) covers: `none`; gym time-since,
  gym progress-to-threshold and a generic time-since-a-date streak; host
  CPU/GPU/network/composite load; the clock; time until sunset/sunrise; outside
  temperature, feels-like, humidity, rain chance, UV, wind and forecast
  high/low; per-zone temperature and humidity; the indoor/outdoor delta; any
  numeric Home Assistant sensor; live power draw, cost rate and headroom
  against a ceiling; next reminder and overdue reminders; lights on; doors and
  windows open; devices unavailable; WAN status; and Home Assistant health.
- Modules that need to be told WHICH thing they read declare `params`
  (`kind: zone | entity | date | number`), and the config page renders the
  matching picker. Parameters are normalised against the declaration on both
  read and save, so unknown keys are dropped and numbers are clamped.
- `entity-numeric` adopts the chosen sensor's own unit as its base unit, so a
  °C sensor converts like a temperature and a `%` sensor is already a
  percentage rather than a ratio to be scaled again.
- Both surfaces keep their own catalogue, but they read the same data and the
  module IDS must match. The Apple TV fetches `/api/power` and
  `/api/tasks?command=list` on a 30-second cadence, and — like the web client —
  only while a readout that needs them is selected, so no client polls for data
  it will not display.
  `catalogue.test.ts` reads the Swift catalogue and fails if either side has a
  module the other lacks, because a missing id would silently fall back to the
  gym counter on the TV.
- The default selection is `gym` at its default display, which reproduces the
  original whole-hours readout exactly.
- The readout is read-only; tapping/clicking it does not reset or mutate
  anything.
- It uses the same display font and heading font weight as dashboard headings,
  with dedicated configurable color and opacity (theme slot `gymNumber`).

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
