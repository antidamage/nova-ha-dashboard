# ColorEncoder — the rotary colour control

Adeline, 2026-09-10. Replaces every colour-selection widget on the Nova
Classic dashboard surface and in `/config` with one reusable rotary control.

Plan: none on disk — plan mode ended before a plan file was written, so this
spec was written as the first task of execution instead.

The prototype the visual design was signed off from:
`https://claude.ai/code/artifact/968f633d-0b49-48db-879f-5a0981a6034b`.

## What it is

A large, smooth, soft dial. A row of small lights across its centre says
which channel the dial is currently turning. Around the dial is a sunken ring
filled with the resulting colour — that ring is the *entire* colour readout.
There is no hex code, no RGB triplet, no numeric value anywhere on the
control.

Files:

| | |
|---|---|
| `app/components/ColorEncoder.tsx` | the control |
| `app/components/colorEncoderModel.ts` | HSVA maths + `ThemeColorValue` adapters |
| `app/globals.css` | its styles, under `.color-encoder*` (this surface uses `globals.css`, not CSS modules) |

## Geometry — everything derives from one number

`--ce-size` is the knob diameter and the only scale input. Valid range
**50px–200px**; the component clamps to it. 200px on the zone lighting card,
50px in config.

| Part | Size |
|---|---|
| Colour ring cross-section | `10% of --ce-size` |
| Outer bevel | `2.2% of --ce-size` each side |
| Total footprint | `--ce-size × 1.244` |
| Checkerboard tile | `5% of --ce-size`, floor 5px |
| Light width | `4.8% of --ce-size`, floor 3px |
| Light height | `2 × light width` |
| Gap between lights | `3 × light width` |
| Index line | `1.2% × 20%` of `--ce-size`, from `7%` inset |
| Notch | `5%` circle at `30%` from top |
| Label gap | `5% of --ce-size` |

Label sits above the dial, centred, uppercase, letter-spaced — the same
treatment as existing config control labels.

## Layers, outside in

1. **Outer bevel** — raised lip around the ring.
2. **Glow** — behind the ring, keyed to the current colour (rules below).
3. **Checkerboard** — light/dark grey, clipped to the ring annulus.
4. **Colour ring** — `rgba(current colour, alpha)` over the checkerboard, so
   lowering opacity shows the checkerboard through.
5. **Ring shade** — the inset shading that makes the ring read as a sunken
   channel rather than a painted band.
6. **Inner bevel** — the lip between ring and knob.
7. **Knob face** — soft CSS-gradient dome. **Its lighting never rotates.**
8. **Rotor** — the only layer that turns: index line, notch, faint hairline
   texture.
9. **Fixed specular** — above the rotor, so the texture passes under a
   stationary highlight.
10. **Lights** — dead centre, stationary, one lit at a time.

The annulus clip is
`radial-gradient(circle closest-side, transparent 0 83.3%, #000 83.5% 100%)`
on an element sized `--ce-size + 2 × ring`.

## Channels

Fixed order, left to right, matching the click-cycle order:

1. **hue** — wraps forever, no ends.
2. **brightness** — stops at 0 and 100.
3. **saturation** — stops at 0 and 100.
4. **opacity** — optional fourth light, stops at 0 and 100.

Exactly one light is lit at any time. Adding the fourth light is opt-in per
call site (`channels` prop), not a global switch.

## Interaction

- **Tap / click** cycles the active channel, wrapping. The threshold is the
  surface's existing `TAP_MOVE_THRESHOLD_PX` (5px) from
  `app/components/sliderTapGesture.ts` — reused, not re-invented. Distance
  only: a slow, deliberate press still cycles, so `TAP_MAX_MS` does not apply.
- **Drag** adjusts the active channel only, from wherever on the dial the
  drag started. Right and up increase; left and down decrease; a diagonal
  sums the two — the signed input is `dx - dy` in px.
- **Sensitivity**: hue `0.5°/px`; brightness, saturation and opacity
  `0.333%/px`. Holding Shift or Alt divides by 8. Either modifier alone is
  enough; both is still just fine mode.
- **Rotation**: the rotor turns `0.5° per px` of signed drag input and
  **keeps its accumulated angle** after release — it is an endless encoder,
  not a pointer that snaps back. Rotation is visual only; it carries no value.
- Pointer Events with `setPointerCapture`, so a drag tracks outside the
  element.
- **Keyboard**: focusable. Right/Up and Left/Down arrows nudge the active
  channel (8px-equivalent, 1px-equivalent with Shift). Enter/Space cycles the
  channel.
- No numeric entry, no long-press hex field, no readout — deliberately. Exact
  colours move between slots through the existing theme clipboard
  (`app/components/themeClipboard.ts`).

## Theming

- The knob face is the **current theme's background colour**
  (`--background`, published as `--ce-tint`), and **stays that colour**. Adeline,
  2026-09-10: the accent and highlight colours are not used on the dial.
  Hover and press are achromatic — hover lifts the dome slightly, press
  deepens the inset.
- The **lights** use `--cyber-highlight` when lit and a glossy near-black
  when off. The lit light carries a subtle bloom in the highlight colour.
- Focus ring follows the surface convention: highlight-coloured outline on
  `:focus-visible`.

## Glow

The ring glows in the currently selected colour. Below 50% brightness there
is no glow at all; from 50% to 100% it ramps linearly to full:

```
t      = clamp((brightness - 50) / 50, 0, 1) × alpha
blur   = size × (0.03 + 0.11 × t)
spread = size × 0.012 × t
alpha  = 0.62 × t
```

## Value model

Internal state is **HSVA**: `{ h: 0–360 wrapping, s: 0–100, v: 0–100,
a: 0–100 }`. HSV, not HSL, because that is what a lighting dial means by
brightness and because it maps onto the stored shape exactly (below).

### Mapping to the stored `ThemeColorValue`

The stored shape does not change — no migration, no preferences rewrite.
`ThemeColorValue` stays `{ cursor: {x,y}, intensity, rgb }`
(`app/components/accentColor.ts`).

**Read** (exact for every existing value, because it comes from the stored
rgb and intensity, never from the cursor):

```
[h, s, v0] = rgbToHsv(value.rgb)
v          = v0 × value.intensity / 100
```

**Write**:

```
rgb       = hsvToRgb(h, s, 100)
intensity = round(v)
cursor    = { x: h / 359, y: 1 - s / 100 }
```

This is lossless in the direction that matters:
`appliedThemeRgb(stored) = rgb × intensity/100 = hsvToRgb(h, s, v)`, which is
what every consumer already renders. The cursor keeps being written so
anything still reading pad position keeps working; it is no longer the source
of truth for hue or saturation.

`rgbToHsv` / `hsvToRgb` are new and live in `colorEncoderModel.ts`. Do **not**
add a fourth copy of `hslToRgb` — three already exist (`accentColor.ts`,
`dashboard/lighting.ts`, `lib/wallpaper-color.ts`).

### Opacity

The fourth channel writes the slot's **existing** sibling opacity field
(`ThemeBorderValue.opacity`, `mapWater.opacity`,
`NovaAvatarTheme.lineOpacities[i]`, `gymNumberOpacity`,
`PhonoscopeColorValue.opacity`). No new storage.

**Rule: fold an opacity into the dial only where that opacity belongs to
exactly one colour slot.** Where one opacity governs a pair — map buildings
(low/high) and map radar (low/high) — the existing single slider stays, since
two dials writing one value is worse than one extra slider.

### Form submission

A `name` prop renders a hidden input carrying `#rrggbb` (or `rgb(r, g, b)`
with `format="rgb"`), and `rgba(r, g, b, a)` whenever the opacity channel is
enabled and below 100. Nothing in the dashboard submits a real form today;
the prop exists so the control is complete, and is inert when `name` is
omitted.

### Rounding

Callers store integer intensity, opacity and rgb. The dial keeps its own
unrounded value and adopts an incoming value only when it is a genuinely
different colour (more than 3/255 on any rgb channel, or more than 1 on value
or opacity) — otherwise a fine drag's sub-unit steps would be rounded away
on every echo and the dial would never move. The same rule is why a grey keeps
the hue it had: rgb carries no hue for it, so nothing contradicts the dial's.

## Preview versus commit

The control fires `onChange` on every pointer move and `onCommit` on pointer
up / key up — the same preview-and-commit boundary `SliderControlPanel`
already enforces, so config keeps writing to `/api/theme` once per gesture
rather than once per frame.

## Reuse, override, extend

- Controlled: value in, `onChange`/`onCommit` out. No internal fetch, no
  side effects.
- `channels` chooses 3 or 4 lights and their order.
- `size` (50–200), `label`, `name`, `format`, `disabled`, `className`.
- Every dimension, the tint, and the glow are CSS custom properties on the
  root (`--ce-size`, `--ce-ring`, `--ce-tint`, `--ce-glow`, `--ce-color`,
  `--ce-angle`), so a design module or a one-off caller can override any of
  them from CSS without touching the component.
- `sensitivity` prop overrides the per-channel px rates.

## What it replaces

Every one of these loses its old control and gains a `ColorEncoder`:

**Dashboard control surface** — `app/components/dashboard/ZoneControls.tsx`:
the `SpectrumPad` (`DotSpectrumControl`) and the zone `Brightness`
(`DotLineControl`) both go. One 200px, 3-light encoder replaces the pair:
hue and saturation become `rgb_color` (at full value), brightness becomes
`brightness_pct`. Adeline, 2026-09-10: the dial owns the zone's brightness;
there is no second brightness control on the card. Colour presets
The On, adaptive-candlelight, White and Off buttons stay. With every light in the zone off, hue and
saturation are inert and send nothing (the old pad was disabled the same way);
brightness still works, since raising it is how the zone comes back on.

**Config** — `app/components/ConfigControls.tsx`: `ColorSpectrum` and
`ColorIntensitySlider` are removed and replaced by one `ColorEncoderPanel`.
`ConfigColorPicker` (`app/components/ConfigColorPicker.tsx`) is deleted with
them. Call sites:

- `app/components/AccentConfig.tsx` — `renderWidget`: accent, highlight,
  background, border, `map.*` (7), `map.radar*` (2), `title.light`,
  `title.dark`, `clockColor`, `voiceTranscript.background`,
  `voiceTranscript.text`.
- `app/components/NovaAvatarConfig.tsx` — `renderWidget`: gradientCenter,
  gradientOuter, gradientAlert, gymNumberColor, voiceGlowColor,
  lineColors[0..2]. The `NovaOpacity` slider goes; those opacities become
  fourth lights.
- `app/components/phonoscope/ColorThemeLibrary.tsx` — `PhonoscopeColorValue`
  slots, 4-light, its separate `Opacity` slider removed.

`ColorWidget` (the swatch grid cell and its popover) stays — it is the
container, not the picker.

`nova-ui-system9/src/components/controls/ColorEncoder.{tsx,module.css}` is
deleted, along with its exports, README row and showcase card. Adeline,
2026-09-10: it was a poor first attempt and is not reused.

## Done means

- The control exists, is scaled by one prop, and renders identically at 50px
  and 200px other than scale.
- Tap cycles; drag adjusts the active channel with the specified signs and
  rates; hue wraps and the others stop; Shift/Alt is 8× finer.
- The rotor turns while dragging and the knob's lighting does not.
- The ring shows the colour, the checkerboard shows through as opacity drops,
  and the glow follows the 50% rule.
- The knob never takes the accent or highlight colour; the lit light always
  does.
- Every widget in the replacement list above is gone, with no colour
  spectrum pad, intensity slider or folded-in opacity slider left behind.
- `npx tsc --noEmit`, `npm run test:unit`, `npm run test:e2e` clean.
- An adversarial visual gauntlet passes: the control screenshotted at 50px,
  120px and 200px, in dark and light themes, in every channel state, with
  opacity at 100 and 40 — reviewed against this spec until a reviewer finds
  no deviation.
