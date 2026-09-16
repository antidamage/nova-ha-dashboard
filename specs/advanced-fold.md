# The Advanced fold

Adeline, 2026-09-14. Plan `we-have-a-concept-unified-lamport`, task log
`20260914T040659Z-182a2a14`. Revised the same day by plan
`we-ve-separated-the-landscape-s-ancient-parnas`, task log
`20260914T101019Z-06c0031b`: every sub-panel scrolls on its own, the default
area keeps its size when Advanced opens, and the hurdle became an 80px rubber
band.

Each sub-panel shows a chosen default view, and a sunken line marks where the
rest begins. A **sub-panel** is one independently scrolling area of a zone's
controls: a lighting zone's body, each of Outside's light / weather / camera,
each climate card, Network's router and Computers, Power.

| File | Holds |
|---|---|
| `app/components/dashboard/AdvancedFold.tsx` | facade; the component (scroller, default region, divider, advanced region, gesture) is in `advanced-fold/AdvancedFold.tsx`, its axis helpers in `advanced-fold/scroller-model.ts` |
| `app/components/dashboard/advancedFoldBand.ts` | the band curve and constants, pure functions |
| `app/globals.css` | `.advanced-fold*` rules, landscape and portrait |
| `app/components/dashboard/useClickDragScroll.ts` | the page's mouse drag and wheel, which the fold has to cooperate with |

## The divider

- A sunken line across the panel's inner width (landscape) or height
  (portrait) — an inset bevel, the same treatment as `RotaryEncoder`'s sunken
  ring, not a border.
- "ADVANCED" sits beside it: mono, uppercase, ~0.7rem, in the theme accent
  (see "The line is the accent colour" below).
- A solid flattened triangle follows the text, pointing toward the advanced
  side, in the text's colour. A CSS triangle.
- **The line rests against the perceptual bottom (landscape) or right edge
  (portrait) of the sub-panel.** A short default view still pushes it there.

## Every sub-panel scrolls on its own

- **Each sub-panel is its own scroller** (Adeline, 2026-09-14: "individual
  sub-panels are not meant to scroll together"). Scrolling Outside's weather
  never moves the light or the camera. The zone panel body
  (`.zone-panel > .mt-8`) is not a scroller any more.
- A sub-panel with no advanced content is the same component with `advanced`
  omitted (or `null`): an independent scroller, no divider, no gesture. Climate
  cards, Network's two sub-panels, Power before its first sample arrives.
- Landscape: the scroller runs vertically (`overflow-y: auto`,
  `overflow-x: hidden` — a sideways overflow would make the page's drag-pan and
  wheel-pan treat the sub-panel as a sideways scroller and stop panning over
  it), `overscroll-behavior: contain`, no visible scrollbar. Portrait: the
  mirror image (`overflow-x: auto`, `overflow-y: hidden`).
- Landscape needs the chain from `.control-stage` down to each sub-panel to have
  a definite height: every `minmax(min-content, 1fr)` row floor on that chain
  (the lighting zone panel, `.lighting-column`, the Network grid) becomes
  `minmax(0, 1fr)`, or the stage grows instead of the sub-panel scrolling. The
  "never clipped" rule of `specs/landscape-layout.md` now holds because each
  sub-panel scrolls, not because rows grow.

## Size lock

Adeline, 2026-09-14: "the area above the advanced divider should be the size of
the sub-panel it is on. currently moving into the advanced divider expands the
sub-panel horizontally and shortens the non-advanced display area."

- **Opening Advanced never changes the sub-panel's width or height, and never
  changes the default area's size.** Measured closed and open, both rects match
  to within 1px, at every viewport.
- The default area's minimum size along the fold axis is the scroller's
  **content-box** size (the sub-panels carry padding) less the divider's size,
  measured with a `ResizeObserver` — not a percentage of the track, which grows
  once Advanced is open. Closed, the divider is fully inside the sub-panel.
- Portrait's default area is exactly that width (the panel's content width less
  the divider), so the line stands inside the right edge rather than just past
  it.
- Landscape: the advanced region contributes no intrinsic width
  (`contain: inline-size`), so the sub-panel's width comes from its default view
  alone. Advanced content is re-laid-out to fit that width.
- Portrait: the advanced region contributes no intrinsic height
  (`contain: block-size`), so the sub-panel's height comes from its default view
  alone. Advanced content grows sideways instead.

### Landscape advanced layout

- Advanced is a grid of cells wrapping to fill the width:
  `repeat(auto-fill, minmax(min(100%, 240px), 1fr))`, rows as needed.
- List-shaped cells span the full row and wrap their own items inside: the
  light events, the per-light switch-on settings, the forecast days, the camera
  events, Saved Captures, the power device list and summary rows.
- Nothing inside Advanced is wider than the sub-panel's default view.

### Portrait advanced layout

- Cells are **natural width, packed** side by side (Adeline, 2026-09-14),
  several visible at once where they fit, each capped at the panel's width.
- Cells are no taller than the default view. A list-shaped cell flows its items
  into columns at that height, so it grows sideways; only a single item taller
  than the panel scrolls inside itself. Use a grid
  (`grid-auto-flow: column` against the definite height), not
  `flex-direction: column; flex-wrap: wrap` — a wrapping flex column does not
  widen for its extra columns in Chromium or WebKit, and the items spill over
  the next cell.

## The gesture

Adeline, 2026-09-14: "make it 80 pixels of travel … as the click or tap drags up
it starts to lag behind more and more until reaching a breaking point and the
restriction disappearing and allowing access to advanced. scrolling back up
will restore this rubber band feeling."

Landscape pulls upward (content moves up); portrait pulls leftward (content
moves left). Below, "offset" is `scrollTop` in landscape and `scrollLeft` in
portrait, and "the boundary" is the largest offset the closed fold allows — 0
when the default view fits, more when it is taller than the sub-panel and has
to be scrolled through first.

- **Locked.** At the boundary, travel toward Advanced is caught. Input travel
  `p` accumulates; the content moves by
  `d(p) = 28 × (1 − (1 − p / 80)²)` px — nearly 1:1 at first (slope 0.7), falling
  to no movement at all as `p` reaches 80.
- **Released before 80px:** the content springs back to rest over 180ms,
  ease-out.
- **The break, at 80px of input:** the advanced region appears and the content
  rubber-bands forward to **where it would be had it followed the input 1:1 the
  whole way** — offset = boundary + `p`, clamped to the scroll range. It gets
  there over 220ms with a slight overshoot
  (`cubic-bezier(0.2, 0.9, 0.3, 1.15)`), starting from where the band left it,
  so nothing jumps.
- **After the break** input tracks 1:1 for the rest of that gesture; the fold
  drives the offset itself, since the browser will not start a native scroll in
  a touch whose moves were prevented. The next gesture scrolls natively. Mouse
  drags are always driven by the fold (the page's mouse drag never scrolls a
  horizontal scroller, and in landscape it only finds scrollers at mousedown),
  so in portrait a mouse can still scroll through Advanced and back.
- **Re-lock:** when the offset comes back to the boundary, Advanced closes and
  the default view is exactly as it was. The next pull meets the 80px band again.
  There is no resistance on the way back.
- Offsets the fold writes itself (the break) never count as a return to the
  boundary. Nor does a clamp caused by Advanced's own content shrinking (a
  collapsed "Inferred base loads", a deleted capture): only a scroll the user
  made closes the fold.
- If opening would leave nothing past the boundary to scroll to (the advanced
  content is empty), the fold does not open.
- Touch, mouse drag and wheel all go through the same machine.
- **Wheel counts at a quarter** (Adeline, 2026-09-14): a mouse notch is about
  100px, which would break an 80px band at once, so it takes three or four
  notches in a row. `deltaMode` is normalised to pixels first (lines × 16, pages
  × the sub-panel's size). The pull decays if the wheel stops for 400ms. Portrait
  folds take only `deltaX` (trackpad sideways, or Shift+wheel) — a vertical
  wheel over a portrait sub-panel always scrolls the page.
- A drag that starts on a control owning its own drag never pulls the fold: an
  input, textarea, select, `role="slider"`, `role="switch"` (knob toggle
  rings), contenteditable, the map, or anything `data-nova-no-drag-scroll`. The
  check walks from the target up to the fold's root and no further. It is not
  `startsInNonDraggable`, which also rejects any overflowing scroller — and the
  fold now is one.
- Touch decides its axis in its first 8px. Travel off the fold's axis is left
  alone, so a vertical swipe over a portrait fold scrolls the page.
- `touch-action` is read when a touch starts, so it is set for the next gesture:
  while locked at the boundary a landscape fold is `pan-x` and a portrait fold
  `pan-y` (the cross axis still pans natively; the fold axis is the fold's to
  handle); otherwise it is left at its default.
- Transitions are off while a finger or mouse is moving the band and while the
  compensation is applied. They are on only for the spring-back and the break's
  220ms, and the transform is cleared to `none` when that transition ends. The
  compensation is computed from the offset actually applied after clamping.
  The break opens the region and writes the offset in a layout effect, after
  the advanced region has mounted.
- `prefers-reduced-motion: reduce`: no springs; the content goes straight to its
  resting or 1:1 position.
- The page's own mouse drag (`useClickDragScroll`) still pans the page with the
  cross-axis travel. Its window wheel handler leaves a wheel the fold has
  consumed alone (`defaultPrevented`).

## State

- **Every fold is closed on load, always.** Fold state is never written to
  storage. Page scroll (`useScrollRestore`), accordion open/closed and zone
  selection keep restoring exactly as they do today.
- A layout flip (landscape ↔ portrait) closes every fold.
- **Picking another zone closes the fold** (Adeline, 2026-09-14): each zone's
  panel starts closed when it is chosen. The zone controls are keyed by zone id.

## What each sub-panel puts below the line

| Sub-panel | Default | Advanced |
|---|---|---|
| Quick Access | everything | **no fold** |
| Climate cards (each its own sub-panel) | everything | **no fold** |
| Lighting zones and subzones (Home, Bedroom, Lounge, Kitchen, Conservatory) | the colour dial, centred in the space above; the preset buttons (On / Adaptive / White / Off) in a row along the bottom, spaced above the line | the room's readouts (temperature, humidity, target temperature) — readouts only; House Party; the zone's light events; the per-light "may be switched on by an event" settings |
| Outside — light | the colour knob with On / Off | the Outside zone's light events |
| Outside — weather | every tile it shows today | the daily forecast, one entry per day |
| Outside — camera | the camera stage | the latest five events as a list (first), then Saved Captures |
| Network — router | the router's name (TP-Link) and WAN state badge, router gauge, throughput, and the WAN status card | **no fold** |
| Network — Computers | Computers with Sleep and Wake | **no fold** |
| Power | the three charts, the current-use strip, the daily estimate, the metering plugs | the numeric readouts: billing estimate, billing to date, the summary rows, base loads, the device list, and the calibration and tariff text |
| World, Tasks, voice transcript | everything | no fold |

**Network is two sub-panels with no Advanced section** (Adeline, 2026-09-14):
everything for the WAN and the TP-Link router sits in the router sub-panel, and
the Sleep/Wake computers in the other.

**Climate controls do not belong to a zone.** A lighting zone shows the room's
temperature, humidity and target temperature as readouts in Advanced, and
nothing that commands the heater or the aircon — that is the Climate panel's
job.

## Done means

- The line is visible and sits at the bottom (landscape) or right edge
  (portrait) of every sub-panel with a fold, at 1920×1080, 1366×768, 430×932 and
  820×1180.
- Opening Advanced leaves the sub-panel's rect and the default area's rect
  unchanged (±1px); nothing inside Advanced is wider (landscape) or taller
  (portrait) than the sub-panel.
- A 60px pull stays closed, the content moves less than 28px, and it springs
  back. A 100px pull opens, and 400ms later the offset is within 4px of the
  boundary + 100. Same by touch, mouse drag and wheel.
- Scrolling back to the boundary closes Advanced and the default view returns to
  its closed rect; the next pull resists again.
- Scrolling one sub-panel leaves every other sub-panel's offset unchanged.
- A drag starting on a knob or a knob's toggle ring does not pull.
- Power at 1366×768, whose default view is taller than the column: the default
  view scrolls freely, the band engages only at its end, and scrolling back to
  that point re-locks.
- Closed, the divider is inside the sub-panel's rect on both axes.
- Mouse drag-pan and wheel-pan still move the page over every sub-panel in
  landscape; a vertical wheel over a portrait sub-panel scrolls the page; the
  portrait page has no sideways overflow.
- Wheel: three 100px notches stay closed, four open.
- With reduced motion the break lands on the 1:1 position with no animation.
- Choosing another zone and coming back shows the fold closed.
- A reload with a fold open comes back with it closed, while page scroll and
  zone selection restore as before.
- Unit tests (`advanced-fold/AdvancedFold.test.tsx`, `advancedFoldBand.test.ts`) and
  `e2e/advanced-fold.spec.ts` cover the above.

## Reminders timer

System / Reminders places `TimerEncoder` in the default area and Today/Upcoming
`TaskLists` in the advanced area of the shared `AdvancedFold`. See
[status-orb-stack.md](status-orb-stack.md).

## Round 2 (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2, task log
`20260914T101019Z-06c0031b`. These rules supersede the matching parts above.

### Drag band is longer and harder; wheel unchanged

- **Touch and mouse drags break at 160 px of input**, and the content moves at
  most **14 px** before the break: `d(p) = 14 × (1 − (1 − p/160)²)`.
- **Wheel keeps its own band**: 80 px of (quarter-weighted) travel, 28 px curve,
  400 ms decay — unchanged. Drag and wheel constants are separate.
- Everything else about the break (1:1 landing, 220 ms overshoot, 180 ms
  spring-back, reduced motion) is unchanged.

### Where a drag can start

- A drag may start on the divider **or anywhere in the sub-panel that is not a
  control** — the default view's whitespace and headings, and the Advanced
  region's whitespace, titles and labels — in both directions (opening and
  closing). Controls that own a press or drag (buttons, inputs, switches,
  sliders, knobs, maps) still do not start one; a tap on a button stays a tap.
- The inner-scroller exclusion applies only to a real scroller that still has
  room to scroll in the drag direction.

### The line is the accent colour

- The divider line, the "ADVANCED" label and the triangle use the theme accent,
  keeping the sunken bevel.
- **The accent is `--cyber-line`, not `--cyber-highlight`.** Adeline, 2026-09-16:
  the divider was still reading as the wrong colour because this section
  originally named `--cyber-highlight`, which `accentColor.ts` sets from the
  theme's *highlight* field (`applyCssColor("cyan", highlight)`). The accent is
  the one applied as `applyCssColor("line", accent)` — `--cyber-line`, with
  `--cyber-line-rgb` for alpha compositing.

### Wheel axis

- **A vertical wheel never scrolls the landscape page sideways**, anywhere on
  the page. Sideways page travel is horizontal wheel (`deltaX`, including
  Shift+wheel as the browser reports it) only.
- **A vertical wheel never moves a portrait fold sideways.** Portrait folds take
  `deltaX` only (already the rule; now also true of every other sideways
  scroller on the portrait page).
- A vertical wheel over a landscape sub-panel scrolls that sub-panel and feeds
  its fold's pull as before.

### Portrait: lists flow into columns

- In portrait no Advanced cell may make the sub-panel taller. The zone's
  "may be switched on by an event" list, the light events list and any other
  list cell flow their rows into as many columns as needed at the default
  view's height (grid, `grid-auto-flow: column`). Seen on an iPad: the Home
  lighting panel doubled in height when opened — that must not happen at any
  portrait size (768×1024, 820×1180, 430×932, 1080×1920).

### Reminders sub-panel width

- The Reminders sub-panel is the one exception to "Advanced adds no width":
  its **landscape sub-panel is twice its previous width**, and its **portrait
  Advanced cell may be up to twice the panel width**, scrolling sideways. See
  `specs/tasks-panel.md`.
- The Reminders fold gets a definite height in landscape (the Tasks stage chain
  passes the column height down), so it opens with the band like every other
  fold.

### Tests (carried over from the round-1 review)

- No fixed sleeps in `e2e/advanced-fold.spec.ts`; wait on visible state. The
  spec passes with the configured workers, twice in a row.
- Touch coverage through CDP `Input.dispatchTouchEvent` with `hasTouch`: 120 px
  stays closed, 180 px opens, a vertical swipe over a portrait fold scrolls the
  page.
- Unit tests for both bands' constants and the drag-surface rules.
