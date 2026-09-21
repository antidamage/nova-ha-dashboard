# Dial preset band

Adeline, 2026-09-16. Applies to every round control (RotaryEncoder and its
wrappers: ColorEncoder, TemperatureEncoder, TimerEncoder).

## Behaviour

- Every round control reserves a band beneath it for preset buttons, whether it
  has presets or not. Timers and climate knobs reserve it empty.
- The dial is centred in the region above the band. The band never pushes the
  dial up or off-centre.
- Purpose: dials line up across panels, or at least look consistent.

## Numbers

| Surface | Band | Gap above band |
|---|---|---|
| Panels (zone lighting, outside light, climate cards, timer) | `--dial-preset-band` 80px (zone preset grid: 68px buttons + 5px padding + 1px border per side) | `--dial-preset-gap` 8px |
| Quick Access (lights and Apple TV segments, climate knobs) | `--quick-preset-band` 44px (quick button height) | 8px |

**The row hugs its dial (Adeline, 2026-09-22).** A titled dial's box reserves
the title's band above *and* below the knob — the band below is empty air, and it
is what held each preset row a whole knob-slack below the dial that owns it. The
row keeps its place in the band and takes that air back:

- `--dial-preset-pull` 22px, the air under a 200px dial's knob, applied as a
  negative `margin-block-start` with `align-self: start` on the row.
  `dialPresetPull(size)` computes it from the dial's own geometry, and the
  Lounge's halved pair publishes its own (14px at its 100px dials).
- Quick Access publishes `--quick-dial-pull` from `QuickAccessCard` the same
  way, beside `--quick-dial-slot`.
- Measured in Chromium at 1920x1080, dial circle to preset row: a lighting
  panel 58px → 20px, the Lounge's halved pair 8px, Quick Access 23px → 8px. An
  untitled dial (the Outside light) keeps 42px: its box has no air under it, so
  what is left is the 1fr row centring it, which this change does not touch.
- Dial centres move 8px down, together: the row gap went 24px → 8px, and the
  dial is centred in the row above the band. Every panel shifts by the same 8px,
  which is what keeps them aligned with each other.
- A container whose band is empty (the climate knobs, the timer) has nothing to
  move, so its dial does not shift either.

## Same rules for lights, timers and climate

Adeline, 2026-09-16 (follow-up): climate dials follow the lights' rules exactly.
For now the band is for alignment only.

- Every panel dial container has 20px above the dial's box and 8px below the
  band (zone/outside: 8px container + 12px colour-encoder padding).
- A climate knob card with an empty header (no title, no fault pill, no module
  action) hides the header, so its knob starts where a lighting dial does.
- Measured at 1920x1080 against the e2e fixtures: dial centres lights 482px,
  climate 481px, timer 476px.

## Implementation

`app/globals.css`, "Dial preset band": panel containers are a two-row grid,
`minmax(0, 1fr)` for the dial and the band height for presets. Containers with
no presets fill row 2 with an empty `::after`. Quick Access keeps the lights
preset row at least 44px and gives each `.quick-climate` a 44px `::after`.

## Done

The dial centre sits at the same height in neighbouring panels of equal height,
with or without presets, in landscape and portrait.
