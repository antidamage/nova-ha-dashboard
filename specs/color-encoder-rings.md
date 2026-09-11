# RingedColorEncoder — the colour dial with arc sliders

Adeline, 2026-09-11. A copy of `ColorEncoder` that carries up to five extra
sliders as concentric arc tracks around its colour ring, with the dial's label
moved onto the knob face.

Plan: `dazzling-splashing-mitten` (`~/.claude/plans/dazzling-splashing-mitten.md`).

Everything about the dial itself — channels, drag rates, tap cycle, haptics,
index angles, glow, light/dark detection, the HSVA value model, preview versus
commit — is inherited from `specs/color-encoder.md` and is not restated here.
This spec covers only what differs.

## Scope

- New component `RingedColorEncoder` in `app/components/RingedColorEncoder.tsx`.
- Its styles are a **copy** of the `.color-encoder*` block in `app/globals.css`
  under the class prefix `.ringed-encoder*`, so the two dials can evolve
  independently. Editing one never changes the other.
- HSVA maths is imported from `app/components/colorEncoderModel.ts`, not
  duplicated.
- `ColorEncoder`, its CSS and every one of its call sites stay unchanged.
  Moving existing call sites onto the ringed dial is a later task.
- A demo page at `/color-encoder-rings`.

## Label on the knob

There is no label above the dial. The `label` prop renders on the knob face,
**above the LEDs**, mirroring the channel caption below them:

- Bottom edge at `50% − LED width − 5.5% of --ce-size` (the caption's top edge
  is `50% + LED width + 5.5%`; the LEDs are `2 × LED width` tall, centred).
- Font `clamp(10px, 7.5% of --ce-size, 14px)`, the caption's rule.
- The caption's etched treatment: black and white overlays, no theme colour,
  uppercase, 700 weight, 0.16em letter-spacing. Light mode uses the caption's
  light-mode colours.
- One line. Longer than 70% of the knob diameter is cut and ends in `...`.
  Three periods, not the `…` glyph: at 10px, letter-spaced and etched, the
  glyph reads as a dash, so the label looks broken rather than shortened.
  Ring labels are cut the same way.
- Still names the dial: the dial's `aria-labelledby` points at it.

## Rings

`rings` prop: an array of up to **5** ring definitions, index 0 innermost.
Entries past the fifth are not rendered, with a `console.warn` outside
production.

```ts
type RingedColorEncoderRing = {
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

`S` is `size`, the knob diameter (still 50–200px). The dial's footprint radius
is `R0 = 0.622 × S` (`--ce-outer / 2`).

| Quantity | Value |
|---|---|
| Label font `F` | `clamp(10px, 0.075 × S, 14px)` — the caption rule |
| Ring pitch `P` | `max(0.085 × S, F + 2px)` |
| Track thickness `T` | `P × 6 / 8.5` — 6% of `S` when the pitch is proportional |
| Gap `G` | `P − T` — 2.5% of `S` when proportional |
| Ring `i` centreline radius | `R0 + G + T/2 + i × P` |
| Footprint diameter, `n` rings | `2 × (R0 + n × P) + thumb overhang` |

The pitch floor exists because a curved label is `F` tall and sits on its
ring's centreline: with a proportional pitch of 8.5% of `S`, a 100px dial puts
rings 8.5px apart while the label font is pinned at its 10px floor, and
neighbouring labels would overlap. With the floor, rings keep their 6 : 2.5
track-to-gap proportion and grow relatively thicker below 200px. At 200px the
pitch is 17px, track 12px, gap 5px; at 100px and 56px the pitch is 12px, track
8.5px, gap 3.5px.

Ring geometry is computed in the component from `size`, because hit-testing
and the SVG paths need it as numbers. It is published on the root as
`--rce-pitch`, `--rce-track` and `--rce-rings` for layout and styling, but
overriding those variables does not move the rings.

### Arc

Each track runs **270°**, from 7:30 over the top to 4:30 — the sweep the
dial's index uses for 0–100 channels (`angle = −135° + 270° × t`, clockwise
from 12 o'clock). The 90° gap at the bottom holds the labels.

The thumb's travel is inset so its ends never leave the track: its centre runs
from `−135° + δ` to `135° − δ`, where `δ` is half the thumb's angular length on
that ring. The value still maps across its whole `min`–`max` range.

### Track

A **sunken channel**, the same treatment as the colour ring: a dark well with
inset shading and a thin raised lip. In light mode the lip and shading go
paler, as the colour ring's do, but the well goes darker, as the unlit LEDs'
wells do, so the white fill still reads against it.

The track is **filled from its start (7:30) up to the thumb's centre in white,
like the lit LED, and the fill glows**: a single tight white bloom,
`max(4px, 30% of T)`, with the px floor the LED uses so it still reads at
small sizes. The fill is narrower than the well (about 60% of `T`) so the
well's edges still show it as a channel. A second, wider bloom was tried and
dropped: it filled the gaps between rings and washed out the wells' edges. At
`min` the fill is empty.

### Thumb

A raised arc segment that **bends with its track**: it is drawn along the
ring's own curve, not as a straight capsule. It is slightly thicker than the
track (`1.3 × T`), with rounded ends, and its visible length is `2.4 × T`
including the ends — a constant length, so it reads the same size on every
ring and the angle it covers shrinks outward. Painted in the knob's own tint
(`--ce-tint`) with a light top edge and a drop shadow, like a small piece of
the knob. No theme colour.

### Ring label

Each ring's label is **curved along its own ring through the bottom gap**,
centred on 6 o'clock, on the ring's centreline. It reads left to right with
its ascenders toward the centre (a smile curve), so it is upright. Font `F`,
the caption's etched treatment. **Name only — there is no value readout on a
ring**; the thumb's position is the readout.

A label longer than the gap's arc length at its radius, less half a track
thickness of clearance at each end, is ellipsised.

### States

- A ring whose `disabled` is set, or any ring when the whole control is
  `disabled`, is drawn at 45% opacity and takes no input. The 45% is applied
  once per ring, never compounded with the control's own.
- Light mode (`data-mode="light"`, detected as for the dial) applies to the
  rings as described under Track. The lit LED stays white in light mode.

## Interaction

Rings share one pointer surface with the dial.

- **Which ring.** A press is placed by its distance `d` from the centre. `d ≤
  R0` goes to the dial, unchanged. Otherwise ring
  `i = floor((d − R0) / P)`; a press beyond the last ring does nothing.
- **The label gap is dead.** A press whose angle falls in the bottom 90° does
  nothing.
- **Tap the track to jump.** A press on a ring puts the thumb's centre at the
  press angle (through the inset travel mapping) straight away.
- **Drag along the arc.** While the pointer is down, its angle about the centre
  sets the value, clamped at both ends. `setPointerCapture`, so the drag
  tracks outside the element.
- **The gap pins, it never jumps.** Dragging into the gap pins the value at the
  end it was nearer (`min` if the last value was in the lower half of the
  range, `max` otherwise). Once pinned, the thumb stays there until the pointer
  comes back onto the arc on that end's half; coming out of the gap on the far
  side does nothing. A drag can never jump the value from one end to the other.
- **Keyboard.** Each ring is focusable, `role="slider"`, labelled by its own
  label, with `aria-valuemin`/`max`/`now`. Right/Up raise, Left/Down lower, by
  `step` (or 1% of the range when there is no step); Shift is 8× finer.
  `onCommit` fires on key up. Focus shows as a highlight-coloured outline
  following the ring, the surface's focus convention.
- **Preview and commit.** `onChange` fires on every move that changes the
  value; `onCommit` once when the gesture ends, the dial's boundary.
- **Haptics** — see "Clicks" below.
- **No tap-to-type.** Rings do not open `NumericEntryPopover`.

## Clicks

Adeline, 2026-09-11. The dial and every ring click the same way. This goes
one step past `ColorEncoder`, which clicks on every drag release; this copy
stays silent on a release that changed nothing:

- **One click on press.**
- **No clicks while dragging.**
- **One click on release, only if the gesture changed the value.** A drag
  that ends where it started, or that only pushed against an end, releases
  silently.
- A quick tap (under `TAP_MOVE_THRESHOLD_PX` of travel and `TAP_MAX_MS`) is
  one gesture and clicks once: a tap on the dial cycles the channel silently
  after its press click, and a tap on a ring jumps the thumb silently after
  its press click. A press held past `TAP_MAX_MS` without dragging still
  clicks on release when it changed something (the dial's channel, or a
  ring's value from the jump).
- Keyboard nudges do not click; Enter/Space on the dial clicks as the dial
  does.

## Demo page

`/color-encoder-rings` (`app/color-encoder-rings/page.tsx`), standalone in the
manner of `app/shader-test/page.tsx`. Every control is live, with local state
only — nothing is sent anywhere. The page does not mount the status orb, the
browser voice satellite or the first-run experience dialog (they would cover
the dials); it keeps `HapticFeedback` so the clicks can be felt.

1. **Ring count** — the dial at 200px with 0, 1, 2, 3, 4 and 5 rings, side by
   side.
2. **Size sweep** — the 5-ring dial at 200px, 100px and 56px.
3. **Light theme** — a section with a pale `--ce-tint`, so the light treatment
   shows beside dark.
4. **States** — a 4-channel dial with alpha, and a disabled dial.

## Done means

- `RingedColorEncoder` and the demo page exist; this work leaves
  `ColorEncoder.tsx` and the `.color-encoder*` rules untouched.
- The rings behave as above at 56, 100 and 200px, in dark and light.
- No two labels overlap at any size, and no label crosses a thumb at the
  thumb's end of travel.
- `npx tsc --noEmit`, `npm run test:unit` and `npm run test:e2e` pass.
- An adversarial visual review of demo-page screenshots (dark and light, every
  section) finds no deviation from this spec.
- Deployed and checked live on the dashboard.
