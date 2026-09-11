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
| `app/components/colorEncoderGeometry.ts` | ring geometry and pointer maths |
| `app/color-encoder-rings/page.tsx` | the rings demo page, `/color-encoder-rings`; its "Ring fill follows the colour ring" row seeds distinct hues (and one in the light theme) so the fill can be checked against the ring |
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
- **Drag turns it like a real knob: relative, by angle.** Adeline,
  2026-09-11. This replaces the old `dx - dy` px scheme (right/up raised,
  left/down lowered), which is gone. A press anywhere on the knob records the
  angle of the pointer about the knob's centre; every move applies the angle
  swept **since the last sample** to the value. The knob never jumps to meet
  the pointer — grabbing it at 4 o'clock and sweeping 30° clockwise turns it
  30°, wherever the value happened to be, exactly as a real knob does. Rings
  are the exception and jump to the press (see Rings).
- **Sensitivity**: the index follows the hand exactly, so the value moves at
  the rate its own index angle implies: hue `1°` of value per degree turned;
  brightness, saturation and alpha `1/2.7` (`100 / 270°`) per degree. Holding
  Shift or Alt divides by 8. Either modifier alone is enough; both is still
  just fine mode. The `sensitivity` prop overrides these, in units per degree.
- **The swept angle is unwrapped and the centre is dead.** Each sample takes
  the shortest way from the previous angle (so dragging across 12 o'clock
  counts as a small move, not a whole turn), and a sample closer to the centre
  than `0.15 × the knob's radius` is ignored — near the middle a pixel of
  movement swings the angle wildly.
- **The index shows the active channel's value.** Adeline, 2026-09-11: the
  index line is how a vague parameter is confirmed at a glance, so the rotor's
  angle is derived from the value, not accumulated from the drag. Angles are
  clockwise from 12 o'clock:
  - **Brightness, saturation, alpha** (0–100): `angle = −135° + 2.7° × value`.
    0 is 45° below horizontal on the left (7:30), 50 is straight up, 100 is 45°
    below horizontal on the right (4:30); the sweep runs **over the top**, never
    through the dead zone at the bottom.
  - **Hue**: `angle = hue`, so one turn of the knob is one trip round the
    colour wheel — red at 12, cyan at 6. It turns forever: the angle stays
    continuous across 360→0 rather than spinning back.
- **Rotation stops at a channel's limits.** Adeline, 2026-09-11. Brightness,
  saturation and alpha clamp at 0 and 100, so the index stops at 7:30 and 4:30.
  Pushing further past the end moves nothing; reversing moves the value and
  index at once, with no dead zone to wind back through.
- **Changing channel re-points the index.** A tap moves the index to the new
  channel's value with a quick sweep (250ms, ease-out), taking the short way
  round, so it can be watched landing. Outside value changes (a preset, another
  client) sweep the same way. While the pointer is down the rotor tracks the
  value with no transition, so a drag stays 1:1. No sweep under
  `prefers-reduced-motion`.
- Pointer Events with `setPointerCapture`, so a drag tracks outside the
  element.
- **Keyboard**: focusable. Right/Up and Left/Down arrows turn the knob `5.4°`
  — 2% of a 0–100 channel — and an eighth of that with Shift. Enter/Space
  cycles the channel.
- **A quick tap clicks once.** The press clicks and the channel change clicks,
  which is right for two gestures but wrong for one: if the release comes within
  `TAP_MAX_MS` (400ms) of the press, the change is silent. A deliberate
  press-and-hold, released without dragging, still gets both. Enter/Space always
  clicks, having had no press to click for.
- **A drag clicks on press, and again on release only if it changed the
  value.** Nothing while turning, at any rate. Adeline, 2026-09-11: clicking
  during a turn was annoying whatever its rate — this replaces the earlier
  400ms/12px cadence — and a release that changed nothing (a turn that ends
  where it started, or one that only pushed against an end) stays silent. The
  dial does not use the shared `SliderHapticController`, which pulses on
  distance. Keyboard nudges do not click.
- No numeric entry, no long-press hex field, no readout — deliberately. Exact
  colours move between slots through the existing theme clipboard
  (`app/components/themeClipboard.ts`).

## Rings — the arc sliders

Adeline, 2026-09-11: merged in from `RingedColorEncoder`, which was a copy of
this control and is **deleted** — component, `.ringed-encoder*` CSS and
`specs/color-encoder-rings.md` all fold in here. There is one dial again.

A dial carries up to **5** slider rings as concentric arc tracks outside its
colour ring, innermost first. Entries past the fifth are not rendered, with a
`console.warn` outside production. A dial with no `rings` renders exactly as
it did before.

```ts
type ColorEncoderRing = {
  id: string;
  label: string;
  value: number;
  min?: number;     // default 0
  max?: number;     // default 100
  step?: number;    // snaps the value when set
  disabled?: boolean;
  onChange: (value: number) => void;  // continuous, while dragging
  onCommit?: (value: number) => void; // once per gesture
};
```

### Geometry

`S` is `size`, the knob diameter (50–200px). The dial's footprint radius is
`R0 = 0.622 × S`.

| Quantity | Value |
|---|---|
| Label font `F` | `clamp(10px, 0.075 × S, 14px)` — the caption rule |
| Ring pitch `P` | `max(0.085 × S, F + 2px)` |
| Track thickness `T` | `P × 6 / 8.5` — 6% of `S` when the pitch is proportional |
| Gap `G` | `P − T` — 2.5% of `S` when proportional |
| Ring `i` centreline radius | `R0 + G + T/2 + i × P` |
| Footprint diameter, `n` rings | `2 × (R0 + n × P) + thumb overhang` |

The pitch floor exists because a curved label is `F` tall and sits on its
ring's centreline: with a proportional pitch, a 100px dial puts rings 8.5px
apart while the label font is pinned at its 10px floor, and neighbouring
labels would overlap. Rings keep their 6 : 2.5 track-to-gap proportion and
grow relatively thicker below 200px.

Ring geometry is computed from `size` in `app/components/colorEncoderGeometry.ts`,
because hit-testing and the SVG paths need it as numbers. It is published on
the root as `--ce-pitch`, `--ce-track`, `--ce-rings` and `--ce-footprint` for
layout, but overriding those does not move the rings.

### Arc, track, thumb, label

- Each track runs **270°**, 7:30 over the top to 4:30 — the sweep the index
  uses. The 90° gap at the bottom holds the labels.
- The thumb's travel is inset by half its own angular length at each end, so
  its ends never leave the track; the value still spans its whole range.
- The track is a **sunken channel**, the colour ring's treatment: a dark well
  with inset shading and a thin raised lip. In light mode the lip and shading
  go paler while the well goes darker, as the unlit LED wells do.
- The track is **filled from 7:30 to the thumb in the colour ring's colour,
  and the fill glows in it** — both are `--ce-color`, the value the colour
  ring paints, in dark and light mode alike (Adeline, 2026-09-11; an earlier
  revision had drifted to a white fill with only the glow coloured).
  A single tight bloom, `max(4px, 30% of T)`, keeping the LED's px floor so it
  still reads at small sizes. The fill is about 60% of `T` so the well's edges
  still show it as a channel. At `min` the fill is empty.
- The **thumb** is a raised arc segment that bends with its track: `1.3 × T`
  thick, `2.4 × T` long including its rounded ends — a constant length, so it
  reads the same on every ring. Painted in the knob's tint with a light top
  edge and a drop shadow. No theme colour.
- Each **ring label** is curved along its own ring through the bottom gap,
  reading left to right and upright, in font `F` with the caption's etched
  treatment. It is **left-aligned to where its ring's track starts** (7:30),
  not centred on 6 o'clock (Adeline, 2026-09-11), so every ring's label begins
  on the same radius and they stack into a readable column. Name only: the thumb is the readout. A label
  longer than the gap's arc length, less half a track of clearance at each end,
  is cut and ends in three periods (not `…`, which reads as a dash at 10px).

### Ring interaction

Rings share the dial's pointer surface.

- **Which ring**: by distance `d` from the centre. `d ≤ R0` is the knob.
  Otherwise ring `i = floor((d − R0) / P)`; past the last ring, nothing.
- **The label gap is dead**: a press in the bottom 90° does nothing.
- **Tap the track to jump.** Unlike the knob, a ring is absolute: a press puts
  the thumb at the press angle straight away, and the drag follows the pointer's
  angle. A ring is a slider bent round a circle, not a knob.
- **The gap pins, it never jumps.** Dragging into the gap pins the value at the
  end it was nearer, and it stays pinned until the pointer returns to the arc on
  that end's half, so a drag can never jump the value from one end to the other.
- **Keyboard**: each ring is focusable, `role="slider"`, labelled by its own
  label. Arrows move by `step` (or 1% of the range without one), Shift is 8×
  finer, `onCommit` on key up.
- **Clicks** follow the dial's rule: one on press, none while dragging, one on
  release only if the gesture changed the value. A quick tap that jumped the
  thumb is one gesture and clicks once.
- No tap-to-type: rings do not open `NumericEntryPopover`.

## The label sits on the knob

Adeline, 2026-09-11: merged in from the ringed copy, and it applies to **every**
dial — the zone card, Quick Access and every config slot. There is no label
above the dial any more.

- On the knob face, **above the LEDs**, mirroring the channel caption below
  them: bottom edge at `50% − LED width − 5.5% of S`.
- Font `clamp(10px, 7.5% of S, 14px)`, the caption's rule, with the caption's
  etched treatment (black and white overlays, no theme colour, uppercase, 700,
  0.16em tracking) and its light-mode colours.
- One line; longer than 70% of the knob diameter is cut with three periods.
- It still names the dial: `aria-labelledby` points at it.

## Disabled

Adeline, 2026-09-11. A disabled dial is **dark**: no LED is lit, the ring's
glow is off, and the whole control keeps the faded treatment it has now. The
colour ring still shows its colour — it is the readout — but nothing on the
control is emitting. Rings are drawn at 45% opacity and take no input, applied
once per ring and never compounded with the control's own fade.

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

The light-mode well rule is scoped to `[data-lit="false"]`. Unscoped it is the
more specific selector and overrides the lit light's own fill, which left
**no light lit at all** in light mode (found 2026-09-11, by the
`RingedColorEncoder` review).

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

## The map colour slots carry their sliders as rings

Adeline, 2026-09-11: the map colour controls move their extra sliders onto the
dial's rings, as preparation for later map work. **Only the map slots in this
change** — the voice-transcript slots keep their sliders under the dial for
now, and get rings in a later task.

| Slot | Ring |
|---|---|
| `map.labels` | Label Size (`mapLabelSize`) |
| `map.buildingLow` and `map.buildingHigh` | Opacity (`mapBuildingOpacity`) |
| `map.radarLow` and `map.radarHigh` | Opacity (`mapRadarOpacity`) |

A ring that controls opacity is labelled plain **Opacity** — the dial it sits
on already names the thing (Adeline, 2026-09-11).

Buildings and radar each share **one** value between two colour slots. Both
dials of a pair carry the same ring, and turning either moves the one shared
value (Adeline, 2026-09-11). This supersedes the earlier rule that a shared
opacity keeps a single slider rather than appearing on two dials: that was
written when the alternative was a second slider, and a ring is a far lighter
thing to put on both. The slot's own alpha channel is unaffected.

`ColorEncoderPanel` takes a `rings` prop and passes it through; the retired
`MapLabelSizeControl`, `BuildingOpacityControl` and `RadarOpacityControl`
sliders go with it.

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
- The knob turns by the angle swept from where the press landed, never jumping
  to the pointer; rings do jump to the press.
- Every dial's label is on its knob face, and no dial has a label above it.
- A disabled dial shows no lit LED and no glow.
- Rings render at 0–5, behave as specified at 56, 100 and 200px in dark and
  light, no two labels overlap, and no label crosses a thumb at its end of
  travel. `RingedColorEncoder`, its CSS and its spec are gone, with the demo
  page at `/color-encoder-rings` running on `ColorEncoder`.
- The map slots carry the rings listed above and no sliders under the dial.
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
