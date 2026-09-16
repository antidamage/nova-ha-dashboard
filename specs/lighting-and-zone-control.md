# Lighting and Zone Control

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
