# Portrait dashboard layout

Adeline, 2026-09-14. Plan `we-ve-separated-the-landscape-s-ancient-parnas`,
task log `20260914T101019Z-06c0031b`.

Applies when `(aspect-ratio <= 1)` matches on the dashboard home. Landscape is
`specs/landscape-layout.md`; the folds in both are `specs/advanced-fold.md`.

Portrait used to have one Zones card holding both zone lists in a single grid,
one global selection, and one control stage below. Adeline asked for portrait
to work the way landscape does: "break the zones/subzones and system accordion
tabs apart and put their panels and sub-panels underneath them. the user will
drag left to access the advanced features on the right."

## Page order

Top to bottom, unchanged above and below the zones:

1. Clock, reminder icons, Quick Access — unchanged.
2. **Home card**: the Home tab bar, the Home zone and its subzones, then Home's
   selected zone's controls.
3. **Systems card**: the Systems tab bar, Climate / Outside / World / Network /
   Power / Tasks, then Systems' selected zone's controls — including Tasks.
4. The voice transcript — unchanged.

The combined "Zones" heading is gone in portrait, as it already is in
landscape; each tab bar names its card.

## Tab bars

- A full-width bar at the top of each card (Adeline, 2026-09-14): about 56px
  tall, the title reading normally on the left, a chevron on the right —
  pointing down while open, right while closed. The same border, panel colour
  and momentary feedback as the landscape bar, which stays the vertical bar it
  is.
- Tapping it collapses the card to just the bar: the list and the controls
  both fold away. Tapping again opens it.
- Same memory as landscape: open/closed in `sessionStorage` under
  `nova-config-ui` (five-minute TTL), per-group zone in `localStorage` under
  `nova.dashboard.groupZones.v1`. Both open on a load with nothing remembered,
  Home showing the home zone and Systems showing Climate.
- `HorizontalAccordion` is the component for both orientations; in portrait it
  lays out vertically.

## Selection

- **Each group has its own selected zone in portrait too** (`useGroupSelection`,
  as in landscape). Choosing Outside leaves Home's panel where it is.
- The global selection (the stored zone, the voice agent) is routed to the
  group that owns it, as in landscape.
- Choosing a zone does not scroll the page.
- When a group's selection changes while its card is closed, the card opens.

## The lists

- Home: the home zone full width, its subzones as tiles beneath — the current
  portrait tile sizing, now inside the Home card.
- Systems: the Systems tiles, two per row, as they are now.
- The old merged grid (`.zones-panel > .grid`, the `order` rules that
  interleaved the two groups, and the rules that made the accordion wrappers
  `display: contents` and hid the trigger) is replaced by per-card layout.

## The controls under each list

- The selected zone's controls sit directly under that card's list, inside the
  same bordered card.
- **Sub-panels stack, one per row, full width** (Adeline, 2026-09-14): Outside's
  light, weather and camera; each climate card; Network's router and Computers.
- Each sub-panel with an Advanced section folds sideways
  (`specs/advanced-fold.md`): the line stands on its right edge, a leftward drag
  past the 80px band opens it, and Advanced grows to the right as natural-width
  cells. Opening it never changes the sub-panel's height.
- **Tasks is Systems' panel like any other** (Adeline, 2026-09-14): it renders
  inside the Systems card under the list when Tasks is selected. `TasksPanel`
  stays mounted at all times, whichever zone is selected and whether or not the
  card is open — it runs reminders while hidden. It is mounted once and moved
  into place visually, never unmounted by a collapse or a zone change.

## Done means

- At 430×932 and 820×1180: DOM and visual order is Home bar → Home list → Home
  controls → Systems bar → Systems list → Systems controls.
- Selecting Outside keeps Home's controls; selecting Bedroom keeps Systems'.
- Collapsing a card hides its list and controls; the state survives a reload
  inside five minutes.
- Tasks shows inside the Systems card when selected, and its reminders keep
  firing while another Systems zone is selected or the card is closed.
- Outside's three sub-panels stack; a leftward drag on the weather sub-panel
  opens its forecast to the right without changing its height; a vertical swipe
  over it scrolls the page.
- No sideways page overflow.
- `e2e/portrait-layout.spec.ts`, `e2e/reminder-bar.spec.ts` (portrait) and
  `HorizontalAccordion.test.tsx` cover the above.

## Round 2 (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2.

- **House Party has its own row** in a lighting zone's Advanced section: the
  slide switch and its label on one line across the cell, and whatever sat in
  the second column (room readouts, light events) beneath it — not two
  subdivided columns.
- **Choosing a zone never scrolls the page.** No `scrollIntoView` or snap on
  selection, in either orientation.
- **The live transcript fits the space it has.** No minimum or maximum line
  height; it takes the card's available height and scrolls inside itself.
  Width unchanged.
- Advanced lists flow into columns rather than growing the panel
  (`specs/advanced-fold.md`, "Portrait: lists flow into columns").

### Done means (round 2)

- At 768×1024 and 820×1180, opening Home's lighting Advanced leaves the Home
  card's height unchanged.
- House Party's switch sits alone on its row.
- Selecting zones leaves `window.scrollY` unchanged.
