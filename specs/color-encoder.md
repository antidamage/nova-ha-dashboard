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
100px in config (Adeline, 2026-09-11: 50px was too small to use), 56px in the
Quick Access card.

| Part | Size |
|---|---|
| Colour ring cross-section | `10% of --ce-size` |
| Outer bevel | `2.2% of --ce-size` each side |
| Total footprint | `--ce-size × 1.244` |
| Checkerboard tile | `5% of --ce-size`, floor 5px |
| Light width | `4.8% of --ce-size`, floor 3px |
| Light height | `2 × light width` |
| Gap between lights | `3 × light width` |
| Index line | `1.2% × 10%` of `--ce-size`, flush with the knob's rim |
| Label gap | `5% of --ce-size` |
| Channel caption | `clamp(10px, 7.5% of --ce-size, 14px)`, `5.5%` below the lights; abbreviated below 133px |

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
8. **Rotor** — the only layer that turns: a single index line joined to the
   knob's rim, plus a faint hairline texture. Adeline, 2026-09-11: one mark, not
   two — a line and a notch on a knob this soft read as clutter.
9. **Fixed specular** — above the rotor, so the texture passes under a
   stationary highlight.
10. **Lights** — dead centre, stationary, one lit at a time.
11. **Channel caption** — the active channel's name under the lights, in two
    lengths: `HUE`/`BRIGHT`/`SAT`/`ALPHA`, shortening to `BRT` and `ALPH` below
    133px, the size at which the caption's font hits its 10px floor and a long
    word starts crowding the lights. A channel name, not a value; the ring is
    still the only readout. Stationary, like the lights.

The annulus clip is
`radial-gradient(circle closest-side, transparent 0 83.3%, #000 83.5% 100%)`
on an element sized `--ce-size + 2 × ring`.

## Channels

Fixed order, left to right, matching the click-cycle order:

1. **hue** — wraps forever, no ends.
2. **brightness** — stops at 0 and 100.
3. **saturation** — stops at 0 and 100.
4. **alpha** — optional fourth light, stops at 0 and 100. Adeline,
   2026-09-11: the channel is called alpha, not opacity. The stored field it
   writes keeps the theme's own name (`opacity`), and so does
   `ColorEncoderPanel`'s prop — only the channel is renamed.

Exactly one light is lit at any time. Adding the fourth light is opt-in per
call site (`channels` prop), not a global switch.

**Which light is lit on load** is per call site too, via `defaultChannel`.
Adeline, 2026-09-11: **lighting opens on brightness** — the centre light —
because dimming a room is what that card is reached for, and colour far less
often. A colour picker opens on hue, the first channel, which is the default.

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
- **The index shows the active channel's value.** Adeline, 2026-09-11: the
  index line is how a vague parameter is confirmed at a glance, so the rotor's
  angle is derived from the value, not accumulated from the drag. Angles are
  clockwise from 12 o'clock:
  - **Brightness, saturation, alpha** (0–100): `angle = −135° + 2.7° × value`.
    0 is 45° below horizontal on the left (7:30), 50 is straight up, 100 is 45°
    below horizontal on the right (4:30); the sweep runs **over the top**, never
    through the dead zone at the bottom.
  - **Hue**: `angle = hue`, so one turn of the knob is one trip round the
    colour wheel — red at 12, cyan at 6. The drag rate (0.5°/px) equals the
    rotor's, so the knob follows the hand exactly, and it turns forever: the
    angle stays continuous across 360→0 rather than spinning back.
- **Rotation stops at a channel's limits.** Adeline, 2026-09-11. Brightness,
  saturation and alpha clamp at 0 and 100, so the index stops at 7:30 and 4:30.
  Pushing further past the end moves nothing; reversing moves the value and
  index at once, with no dead zone to wind back through. No haptic click is
  spent on input that moved nothing.
- **Changing channel re-points the index.** A tap moves the index to the new
  channel's value with a quick sweep (250ms, ease-out), taking the short way
  round, so it can be watched landing. Outside value changes (a preset, another
  client) sweep the same way. While the pointer is down the rotor tracks the
  value with no transition, so a drag stays 1:1. No sweep under
  `prefers-reduced-motion`.
- Pointer Events with `setPointerCapture`, so a drag tracks outside the
  element.
- **Keyboard**: focusable. Right/Up and Left/Down arrows nudge the active
  channel (8px-equivalent, 1px-equivalent with Shift). Enter/Space cycles the
  channel.
- **A quick tap clicks once.** The press clicks and the channel change clicks,
  which is right for two gestures but wrong for one: if the release comes within
  `TAP_MAX_MS` (400ms) of the press, the change is silent. A deliberate
  press-and-hold, released without dragging, still gets both. Enter/Space always
  clicks, having had no press to click for.
- **Click cadence**: one click on press, then at most one per 400ms of turning,
  gated behind 12px of travel. The dial does not use the shared
  `SliderHapticController`: that pulses on distance with an 80ms floor, which on
  a fast spin is a dozen clicks a second. Adeline, 2026-09-11: about five times
  less often, hence the 400ms floor — 5x the shared one.
- No numeric entry, no long-press hex field, no readout — deliberately. Exact
  colours move between slots through the existing theme clipboard
  (`app/components/themeClipboard.ts`).

## Theming

- The knob face is the **current theme's background colour**
  (`--background`, published as `--ce-tint`), and **stays that colour**. Adeline,
  2026-09-10: the accent and highlight colours are not used on the dial.
  Hover and press are achromatic — hover lifts the dome slightly, press
  deepens the inset.
- **No theme colour touches the knob face.** Adeline, 2026-09-11. The caption
  is *etched*, not printed: glyphs that catch light with a dark cut above and
  below them, all from black and white overlays, so it reads as engraving over
  whatever tint the knob has and owes nothing to the palette. The knob's own
  colour (`--ce-tint`, the theme background) and the focus ring outside the dial
  are the only theme-derived values left on the control.
- The **lit light is white and glows white**; the others are a glossy
  near-black. Adeline, 2026-09-11: at 50px a light is 3px wide, and a
  tinted one that small does not read. The bloom carries a px floor
  (`max(4px, …)`) for the same reason — a radius derived purely from the
  light's width vanishes with it. Nothing on the dial uses the accent or
  highlight colour now; `--ce-led-on` remains as the override point. The lit
  fill is declared as a **97-byte 1x8 PNG** of its white-to-`#eef2f6` ramp, with
  the gradient kept underneath as a fallback: Chromium's "Auto Dark Mode for
  Web Contents", which Brave exposes as a flag and Adeline runs with, rewrites
  light background *colours* but leaves background *images* alone, so declared
  as a gradient the lit light came out grey there.
- Focus ring follows the surface convention: highlight-coloured outline on
  `:focus-visible`.

### Surviving Brave's auto dark mode

Adeline, 2026-09-11: on desktop Brave, with Chromium's "Auto Dark Mode for
Web Contents" flag on, the **ring goes dark** as a bright colour is
desaturated (and darkens oddly either way on brightness), and the lit LED shows
white for a moment and then settles to a **blue-grey**. Both are that flag
repainting light colours after first paint, not the dial's value — the LED's
PNG fill turned out not to be enough on its own. The ring and the lit LED must
show their true colour with the flag on. Fixes are tried in this order, each
checked under forced dark mode, and the first that holds is kept:

1. `!important` on the ring's and the lit LED's fill.
2. The dashboard opts out of auto dark mode page-wide by declaring
   `color-scheme: dark` on the root (Adeline's pick over a per-control
   workaround). Adeline, 2026-09-11: the page **always** tells the browser it
   is dark, whichever Nova theme — dark or light — is selected; the flag must
   not affect it at all.
3. A tiling image of the exact colour — a generated PNG data URI — instead of a
   CSS colour value, for the ring and the LED.

**Held: option 2 — `<meta name="color-scheme" content="dark">` in
`app/layout.tsx`, mirrored as `color-scheme: dark` on `:root` in
`globals.css`.** Measured 2026-09-11 by sampling swatch pixels:

- With forced dark on, plain, `!important` and gradient fills of white and pale
  colours were all repainted dark (255,230,230 came out 54,36,37); tiling PNGs
  were inverted too (white to black, 255,230,230 to 126,0,0) — the same image
  pass that turns the LED blue-grey after a moment. Options 1 and 3 do not work.
- With Chromium's real `WebContentsForceDark` feature (Brave's flag) in the full
  browser, the browser reports `prefers-color-scheme: dark`; a page declaring
  nothing had 255,207,102 repainted 81,51,0 (the reported symptom), and a page
  declaring `color-scheme: dark` was left untouched.
- Testing trap: the `--blink-settings=forceDarkModeEnabled=true` switch and the
  headless shell do **not** reproduce this. The former repaints even pages that
  declare dark, because it leaves the browser reporting light; the latter
  ignores the feature entirely. Test with `channel: "chromium"` and
  `--enable-features=WebContentsForceDark`.

`body` sets its own `color` and `background` and hides scrollbars, so the
visible side effect of declaring dark is limited to native form controls, which
take the UA's dark styling in either Nova theme.

### Light and dark

The dark treatment is the design; light is its counterpart, not an inversion.
The dial decides which it is **from the colour it is actually painted in**: it
sets `color: var(--ce-tint)` on its root, reads that back resolved, and stamps
`data-mode="light"` when the Rec. 709 luma is over 0.5. The dashboard's two
theme variants differ only in custom-property values — nothing in the DOM says
which is active — so this keeps the control self-contained and correct on the
config page, inside a design module, and for any caller that overrides
`--ce-tint`. It starts dark on the server and first client render (SPEC.md §2)
and re-reads on `nova-accent-change`, `nova-theme-set-change` and
`nova-sun-change`.

In light mode (Adeline, 2026-09-11): the knob is a soft off-white (`#eceef1`),
shading is pulled well back so black shadows do not read as grime on a pale
face, the specular is dropped (a light dome has little to catch), the index line
inverts to dark with a light edge, and the unlit wells go *darker* than in dark
mode — the lit light is white, so the contrast between them has to come from
the wells. The white bloom stays but does little on a pale knob, which is why
the wells carry that work.

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

**A drag owns the value until it ends.** While the pointer is down the dial
adopts nothing, however different the incoming value is. Otherwise an echo that
lands mid-turn — a zone reporting a waypoint of a fade — counts as a genuinely
different colour under the rule above and yanks the dial away from the hand
turning it; at the top of the brightness range it read as a blip down to a low
value (Adeline, 2026-09-11). After release, outside changes are taken again; on
the lighting card `useRemoteSetting` already holds the commanded value through
the fade that follows.

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

## The config surface

Adeline, 2026-09-11: **the dial replaces the colour widget; it does not open in
a popup modal.** There is no swatch card and no open/closed state — the ring is
already the colour preview, so a card showing the same colour was only a click
in the way. Every slot renders its dial inline in the grid, and slot-specific
extras (a toggle, a shared-opacity or size slider) sit under the dial in the
same cell. `ColorWidget` is now that inline cell: children, a label for its
copy/paste actions, and nothing else. The retired card and modal took their CSS
with them (`theme-display-card*`, `theme-colour-popover*`, `theme-inline-editor*`,
`theme-display-swatch/copy/detail/label`), along with the session-stored
"which widget is open" key.

## What it replaces

Every one of these loses its old control and gains a `ColorEncoder`:

On the zone card the dial is labelled **Lights**, not Colour: it sets the
zone's brightness as well as its colour, so naming it after one channel
misdescribes it (Adeline, 2026-09-11).

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
- The rotor turns while dragging and the knob's lighting does not; the rotor
  carries exactly one mark.
- The ring shows the colour, the checkerboard shows through as opacity drops,
  and the glow follows the 50% rule.
- Neither the knob nor the lights take the accent or highlight colour; the lit
  light is white and reads clearly at 50px.
- Every widget in the replacement list above is gone, with no colour
  spectrum pad, intensity slider or folded-in opacity slider left behind.
- `npx tsc --noEmit`, `npm run test:unit`, `npm run test:e2e` clean.
- Brightness, saturation and alpha stop the rotor at their ends; hue does not.
- The index points at the active channel's value per the angle rules above,
  re-points with a sweep on a channel change, and tracks 1:1 while dragging.
- **Sweep smoke test** (Adeline, 2026-09-11), in a real browser against the
  dashboard, with lighting commands intercepted in the page and never sent to
  Home Assistant: from a bright, saturated start, brightness and saturation are
  each driven 0→100→0 in 10% steps and hue through 360° in 30° steps. At every
  step the test checks the dial's value, the index angle and the intercepted
  command payload against the expected HSV, **samples the ring's rendered pixel from a
  screenshot** and compares it with `hsvToRgb` of the expected value, and keeps
  the screenshot for a visual check. It runs once normally and once with
  Chromium's real auto dark mode feature on; both must pass.
  `e2e/color-encoder-sweep.spec.ts`; `COLOR_ENCODER_SHOTS=<dir>` keeps the
  screenshots.
- An adversarial visual gauntlet passes: the control screenshotted at 50px,
  120px and 200px, in dark and light themes, in every channel state, with
  opacity at 100 and 40 — reviewed against this spec until a reviewer finds
  no deviation.
