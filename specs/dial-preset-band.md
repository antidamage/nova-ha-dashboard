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
| Panels (zone lighting, outside light, climate cards, timer) | `--dial-preset-band` 80px (zone preset grid: 68px buttons + 5px padding + 1px border per side) | `--dial-preset-gap` 24px |
| Quick Access (lights segment, climate knobs) | `--quick-preset-band` 44px (quick button height) | 8px |

## Implementation

`app/globals.css`, "Dial preset band": panel containers are a two-row grid,
`minmax(0, 1fr)` for the dial and the band height for presets. Containers with
no presets fill row 2 with an empty `::after`. Quick Access keeps the lights
preset row at least 44px and gives each `.quick-climate` a 44px `::after`.

## Done

The dial centre sits at the same height in neighbouring panels of equal height,
with or without presets, in landscape and portrait.
