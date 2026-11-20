<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# LightEncoder — the lighting knob

alex, 2026-10-21. The lights get their own knob, separate from the colour
picker. Until now every light control was a `ColorEncoder`; from here the
colour pickers in `/config` stay `ColorEncoder`, unchanged, and every light
control is a `LightEncoder`.

Plan: none on disk. The request came with its decisions stated, so this spec
was written as the first step of execution. Items marked *(decided)* were the
implementing agent's call and can be changed here in place.

The dial itself — layers, drag, clicks, rings, tuck-away — is the shared
`RotaryEncoder` base (`specs/color-encoder.md`). The HSVA value model, the
adoption rule ("Rounding"), the drag-owns-the-value rule and the channel
rates are the colour knob's, shared through `useHsvaDial`. This file covers
only what the lighting knob does differently.

Files:

| | |
|---|---|
| `app/components/LightEncoder.tsx` | the knob |
| `app/components/lightEncoderModel.ts` | the ring's solid paint and glow |
| `app/components/useHsvaDial.ts` | HSVA channel state shared with `ColorEncoder` |
| `app/components/dashboard/zones/ZoneColorEncoder.tsx` | the zone binding; renders `LightEncoder` (name kept so call sites do not change) |

Where it is used: every `ZoneColorEncoder` — the zone lighting card, the
outside lights, the Quick Access lights segment and the zone light rules'
"Sets" dial. `MemberEditor`, `ColorEncoderPanel` and every theme slot stay on
`ColorEncoder`.

## Lights

Three, left to right: **Brt, Hue, Sat** — brightness, hue, saturation (alex).
**Brightness is lit on load and is the idle selection.** No alpha. The caption
under the lights is the colour knob's: `BRIGHT`/`HUE`/`SAT`, `BRT` below 133px.

## The ring is the light's colour

alex, 2026-11-21: *"for colour selection just colour the entire ring with
the new colour, no partial gradient. you can use the usual 3d-ish
skeuomorphistic effects on it though, same as the air con control colour
ring."* This replaces the band that filled from the zero point to the mark.

- **The whole ring is one colour**, whichever light is lit and whatever the
  value: the light's hue and saturation at full value *(decided)*, so a dim
  light still shows its colour rather than going black. No arc, no soft ends,
  no empty channel, no `ringMark`.
- **The 3D treatment is the base's**, the same as the climate knob's ring: the
  ring shade (the inset shading that makes it a sunken channel), the bevels and
  the glow lie over or behind the solid paint unchanged.
- **The ring recolours with the value**: hue and saturation turns change it
  live; brightness turns leave it and change only the glow.

## Glow

The glow is the ring's colour, blurred through the annulus. Strength keeps the
colour knob's brightness key — none below 50%, full at 100% —
`t = clamp((v − 50) / 50, 0, 1)` applied to the glow's alpha, `0.9 × t`. Blur
`7% of --re-size` *(decided)*.

## The base's part

Two optional props on `RotaryEncoder`. The climate knob uses both
(`specs/temperature-encoder.md`, "Colour ring"); this knob uses `glowPaint`
(beside the base's `ringPaint`) and no `ringMark`. The empty channel colour, `--re-ring-empty`, is charcoal `#1e2024` on
the dark skin and `#b4b7bd` on the light skin.

- **`ringMark`** — degrees, published as `--re-mark`, a registered `<angle>`
  custom property that transitions 250ms ease-out, with no transition while
  the dial is pressed or under reduced motion. Paints refer to it as
  `var(--re-mark)` so the band moves with the index instead of jumping.
- **`glowPaint`** — a CSS background for the glow. Given, the glow layer
  draws that paint through the ring's annulus and blurs it instead of using
  the `glow` box-shadow.

A caller that passes neither — the colour picker, the Apple TV knob — draws
exactly as before.

## Done means

- Every light surface listed above shows the new knob; config colour pickers
  are unchanged.
- Lights read Brt, Hue, Sat with Brt lit on load.
- The ring is one solid colour at every value of every channel, under the
  base's ring shade.
- Unit tests cover the light order, the default, the solid paint at 0, mid and
  full, the brightness-keyed glow, and that neither light nor colour knob sets
  `--re-mark`.
- Typecheck, lint and the unit suite pass.
