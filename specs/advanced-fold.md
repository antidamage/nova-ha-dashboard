# The Advanced fold

Adeline, 2026-09-14. Plan `we-have-a-concept-unified-lamport`, task log
`20260914T040659Z-182a2a14`.

Panels already scroll vertically inside their column when they overflow
(`specs/landscape-layout.md`, "Vertical overflow"). That scroll is now
deliberate and labelled: each panel shows a chosen default view, and a sunken
line marks where the rest begins.

| File | Holds |
|---|---|
| `app/components/dashboard/AdvancedFold.tsx` | the component: default region, divider, advanced region, gesture |
| `app/globals.css` | `.advanced-fold*` rules, landscape and portrait |
| `app/components/dashboard/useClickDragScroll.ts` | the mouse drag the fold has to cooperate with |

## The divider

- A sunken horizontal line across the panel's inner width — an inset bevel,
  the same treatment as `RotaryEncoder`'s sunken ring, not a border.
- "ADVANCED" sits just above it: mono, uppercase, ~0.7rem, `--cyber-muted`.
  Small and quiet, still legible on every theme.
- A solid flattened triangle pointing down follows the text, wider than it is
  tall, in the text's colour. No outline, no icon font — a CSS triangle.
- **The line rests against the perceptual bottom of the panel.** The default
  region's min-height is the scroller's visible height less the divider, so a
  short default view still pushes the line to the bottom rather than leaving
  it floating mid-panel.

## The gesture

Landscape, vertical:

- Closed, with the scroller at its top, upward travel moves the content with
  resistance: it follows about a third of the input.
- **40px of input travel is the snap.** Released before 40px, it springs back
  closed. Past 40px it snaps open, and from there input tracks 1:1 — the
  advanced content scrolls like any other content.
- Scrolling back to the very top re-engages the lock. Coming back up past the
  line never needs a snap of its own; the resistance is one-directional.
- All three inputs go through the same state machine: touch drag, mouse drag
  (`useClickDragScroll`, which already routes vertical travel into the column)
  and wheel. Wheel accumulates the same 40px.
- Touch has to be handled on a non-passive listener while the fold is locked,
  otherwise the browser scrolls the column out from under the resistance.

Portrait:

- The fold exists in portrait too. **The line is vertical, on the right edge
  of the panel**, and the advanced detail is hidden to the right. The gesture
  is the same shape rotated: drag leftward, 40px, resist then snap.
- Content that would sit below the line in landscape is re-laid-out to flow
  horizontally. Advanced content is therefore a **grid of cells, not rows**;
  in portrait each cell is the full width of the panel's list.

## State

- **Every fold is closed on load, always.** Fold state is never written to
  storage. Page scroll (`useScrollRestore`), accordion open/closed and zone
  selection keep restoring exactly as they do today — a reload restores where
  you were and still backs out of Advanced.

## What each panel puts below the line

| Panel | Default | Advanced |
|---|---|---|
| Quick Access | everything | **no fold** |
| Climate | everything | **no fold** |
| Lighting zones and subzones (Home, Bedroom, Lounge, Kitchen, Conservatory) | the colour dial, centred in the space above; the preset buttons (On / Adaptive / White / Off) in a row along the bottom, spaced above the line | the room's readouts (temperature, humidity, target temperature) — readouts only; House Party; the zone's light events; the per-light "may be switched on by an event" settings |
| Outside — light | the colour knob with On / Off | the Outside zone's light events |
| Outside — weather | every tile it shows today | the daily forecast, one entry per day |
| Outside — camera | the camera stage | the latest five events as a list (first), then Saved Captures |
| Network | router gauge, throughput, Computers with Sleep and Wake | the WAN status card |
| Power | the three charts, the current-use strip, and the daily estimate (kWh and cost per day) | the numeric readouts: billing estimate, billing to date, the device list, base loads, and the calibration and tariff text |
| World, Tasks, voice transcript | everything | no fold |

**Climate controls do not belong to a zone.** A lighting zone shows the room's
temperature, humidity and target temperature as readouts in Advanced, and
nothing that commands the heater or the aircon — that is the Climate panel's
job.

Outside's three areas (light, weather, camera) each become their own
vertically scrolling panel with its own fold. The card still grows sideways as
it does now (`specs/outside-card.md`).

## Done means

- The line is visible and sits at the bottom of every panel in the table, at
  1920x1080 and 1366x768.
- The 40px snap works by touch, by mouse drag and by wheel; a shorter pull
  springs back; the return to the top re-locks.
- A reload with a fold open comes back with it closed, while page scroll and
  zone selection restore as before.
- Portrait folds open sideways and their content is laid out as full-width
  cells.
- `e2e/landscape-panel-overflow.spec.ts` and a new fold spec cover both
  landscape sizes and a portrait size.
