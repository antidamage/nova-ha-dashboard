# Landscape dashboard layout

Produced by: claude-code session_01BWgQ56, task 20260911T074843Z-11075c82
(2026-09-11). Interview answers from Adeline, same date. Takes over Codex's
landscape accordion work (tasks 20260911T025552Z-566ec253 onwards).

Applies when `(aspect-ratio > 1)` matches and the page is the dashboard home
(`isHorizontalDashboard()`). Portrait is unchanged by everything below.

## Page model

- The page scrolls horizontally. Columns sit in one row inside
  `.dashboard-layout`, each `--dashboard-column-height` tall; a column whose
  content is taller scrolls vertically inside itself.
- Mouse: click-drag pans the page sideways; a drag starting inside a
  vertically scrolling column also scrolls that column with its vertical
  travel, at the same time (`useClickDragScroll`). Wheel maps to sideways
  travel except over a vertical scroller. Touch is native.

## Left sidebar (the portrait top bar, turned sideways)

A fixed strip on the left edge, full viewport height, holding what the top bar
holds in portrait.

Scroll progress `t = clamp(scrollX / 400, 0, 1)`.

| item | at t = 0 | at t = 1 |
|---|---|---|
| Status orb | 200px, centred horizontally and vertically in the sidebar | 100px, still centred |
| Sidebar width | 224px (orb + 12px each side) | 124px (100px orb + 12px each side) |
| Shadow gradient | invisible | fully in; black at the left edge fading to transparent at the right, sidebar width |
| Reload button | top of sidebar, fully visible and usable | faded out; no pointer events from t ≥ 0.5 |
| Config link | bottom of sidebar, fully visible and usable | same fade as Reload |
| Mini time / date | invisible | fully in, stacked under the orb's bottom edge |

- Everything is a continuous function of `scrollX`, no timers or triggered
  animations, same contract as portrait's `--nova-header-fade`: stopping
  mid-scroll holds, scrolling back reverses exactly.
- Orb scale is `1 → 0.5` on its native 200px canvas, so the rest state is not
  upscaled.
- Page content begins to the right of the full-width (224px) sidebar at
  scroll 0 and never sits beneath it at rest. As the sidebar narrows, content
  scrolls under the shadow.
- No top padding is reserved for the orb in landscape.
- The orb's voice speaking migration (move to centre and enlarge) still works
  from its sidebar position.
- Devices with the orb off (`data-nova-no-orb`, lite mode): sidebar keeps its
  buttons, no orb.

## Zone accordions joined to their controls

Two `HorizontalAccordion` entries: **Home** (the Home zone and its subzones)
and **Systems** (climate, outside, world, network, power, tasks).

- **Each group has its own selected zone.** Within a group the choice is
  exclusive (Home vs Bedroom; Climate vs Outside). Across groups it is not:
  choosing Climate never changes, hides or collapses Home's selection or
  controls, and the reverse. Applies to every zone.
- Each open entry is one joined unit: vertical title bar, zone list, and that
  group's selected zone's controls attached directly to the right of the list.
  Shared borders, no gap; reads as one bordered panel. Both entries can be
  open at once, each showing its own controls.
- The global selection (portrait, the stored zone, anything that selects a
  zone programmatically) is routed to the group that owns it; the other group
  keeps its choice. Both groups' choices persist across reloads
  (`nova.dashboard.groupZones.v1`).
- A group with no choice yet shows its list alone.
- When a group's selection changes while its entry is closed, the entry opens.
  First load restores saved open/closed state and does not force it open.
- After selection the page scrolls that group's controls into view (instant,
  nearest).
- Tasks: `TasksPanel` must stay mounted at all times (it runs reminders while
  hidden), so in landscape it lives in a fixed column directly after the zones
  panel, shown as the Systems entry's joined panel when Tasks is Systems'
  selection and hidden otherwise or when Systems is closed.
- The list and the controls each scroll vertically on their own; the
  drag-scroll rule above applies to both.
- Controls width: same as the old control stage, `min(760px, 100vw - 80px)`,
  minimum 520px.
- Portrait keeps the old layout and single global selection: list in the
  zones panel, controls in the control stage below.

## Zone control panel: House Party

- House Party spans the full width of its zone panel and is always the panel's
  last row, pinned to the bottom of the panel however short the controls above
  it are (the panel is a flex column; House Party carries `margin-top: auto`).
- Lighting zones only, as before. Portrait and landscape alike.
- The colour dial it used to share a row with now has that row to itself.

## Done means

- Landscape at 1920x1080 and 1280x800: sidebar at 224px with a 200px orb at
  scroll 0, orb centre at half the viewport height; at scrollX ≥ 400 it is
  124px with a 100px orb, shadow in, buttons out, mini time/date in.
  Scrolling back restores the rest state.
- Home open with Bedroom selected and Systems open with Climate selected show
  both units at once; selecting Outside leaves Bedroom's controls in place.
- House Party is full width at the bottom of every lighting zone panel.
- Portrait layout unchanged.
- Unit tests pass; deployed and checked live.
