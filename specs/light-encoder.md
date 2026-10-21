<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# LightEncoder — the lighting knob

Adeline, 2026-10-21. The lights get their own knob, separate from the colour
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
| `app/components/lightEncoderModel.ts` | the filled band's paint and glow |
| `app/components/useHsvaDial.ts` | HSVA channel state shared with `ColorEncoder` |
| `app/components/dashboard/zones/ZoneColorEncoder.tsx` | the zone binding; renders `LightEncoder` (name kept so call sites do not change) |

Where it is used: every `ZoneColorEncoder` — the zone lighting card, the
outside lights, the Quick Access lights segment and the zone light rules'
"Sets" dial. `MemberEditor`, `ColorEncoderPanel` and every theme slot stay on
`ColorEncoder`.

## Lights

Three, left to right: **Brt, Hue, Sat** — brightness, hue, saturation (Adeline).
**Brightness is lit on load and is the idle selection.** No alpha. The caption
under the lights is the colour knob's: `BRIGHT`/`HUE`/`SAT`, `BRT` below 133px.

## The band fills from the zero point to the mark

Adeline: the colour band round the outside fills from the zero point to the
rotary mark, in the light's colour, and its start and end are soft — part of
the glow, not a hard cut-off.

- **Zero point.** Brightness and saturation: 7:30, the index's 0
  (`−135°`). Hue: 12 o'clock, the index's 0°, since hue's index angle is the
  hue itself *(decided)*.
- **The fill ends at the mark**, wherever the index points for the lit
  channel: `2.7° × value` past 7:30 for brightness and saturation, `hue°`
  past 12 for hue.
- **Soft ends.** The fill fades in from nothing over **24°** from the zero
  point and fades out over **24°** centred on the mark *(decided)*: solid to
  `mark − 12°`, gone by `mark + 12°`. Short fills shrink both fades so a value
  of 0 shows nothing: fade-in `min(24°, mark / 2)`, fade-out half-width
  `min(12°, mark / 2)`.
- **Colour.** The light's hue and saturation at full value *(decided)*: the
  fill's length already says how bright it is, so the colour is not darkened
  as well — a dim light would otherwise vanish into the empty channel.
- **The rest of the band is the empty channel**: `--re-ring-empty`, charcoal
  `#1e2024` on the dark skin (the climate knob's no-reading colour) and
  `#b4b7bd` on the light skin *(decided)*. The ring shade still lies over it,
  so it reads as a sunken channel with nothing in it.
- **The fill follows the mark.** When the lit channel changes or an outside
  value arrives, the fill sweeps with the index (250ms, ease-out); under the
  hand it tracks 1:1; no sweep under `prefers-reduced-motion`. A hue drag
  across 12 o'clock jumps the fill from full to empty, as the value does.

## Glow

The glow is the band's own fill, blurred: same arc, same soft ends, so it
never lights the empty part of the channel. Strength keeps the colour knob's
brightness key — none below 50%, full at 100% — `t = clamp((v − 50) / 50, 0, 1)`
applied to the glow's alpha, `0.9 × t`. Blur `7% of --re-size` *(decided)*.

## The base's part

Two optional props on `RotaryEncoder`, used by this knob and the climate knob
(`specs/temperature-encoder.md`, "Colour ring"):

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
- The band is empty at brightness 0, a soft-ended arc from 7:30 to the mark
  in between, and full to 4:30 at 100.
- Unit tests cover the light order, the default, the paint stops at 0, mid and
  full, and that `ColorEncoder` sets no `--re-mark`.
- Typecheck, lint and the unit suite pass.
