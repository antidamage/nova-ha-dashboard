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
| Status orb | 160px, centred horizontally in the sidebar, top-anchored | 64px |
| Sidebar width | 184px (orb + 12px each side) | 88px (64px orb + 12px each side) |
| Shadow gradient | invisible | fully in; black at the left edge fading to transparent at the right, sidebar width |
| Reload button | top of sidebar, fully visible and usable | faded out; no pointer events from t ≥ 0.5 |
| Config link | bottom of sidebar, fully visible and usable | same fade as Reload |
| Mini time / date | invisible | fully in, stacked under the orb |

- Everything is a continuous function of `scrollX`, no timers or triggered
  animations, same contract as portrait's `--nova-header-fade`: stopping
  mid-scroll holds, scrolling back reverses exactly.
- Orb scale is `1 → 0.4` (160 → 64). The orb's 96px base is rendered at a
  larger base size in landscape so the 160px rest state is not upscaled.
- Page content begins to the right of the full-width (184px) sidebar at
  scroll 0 and never sits beneath it at rest. As the sidebar narrows, content
  scrolls under the shadow.
- No top padding is reserved for the orb in landscape.
- The orb's voice speaking migration (move to centre and enlarge) still works
  from its sidebar position.
- Devices with the orb off (`data-nova-no-orb`, lite mode): sidebar keeps its
  buttons, width is the 88px minimum, no orb.

## Zone accordions joined to their controls

Two `HorizontalAccordion` entries: **Home** (the Home zone and its subzones)
and **Systems** (climate, outside, world, network, power, tasks).

- Each entry, when open, is one joined unit: vertical title bar, zone list,
  and — if the selected zone belongs to that entry — the selected zone's
  controls attached directly to the right of the list. Shared borders, no gap
  between list and controls; reads as one bordered panel.
- There is no separate control column in landscape any more.
- Entries open and close independently (both may be open). The selected
  zone's controls attach only to the entry that owns it; the other open entry
  shows its list alone.
- Selecting a zone in an entry that owns it keeps that entry open; selecting
  programmatically a zone whose entry is closed opens that entry.
- After selection the page scrolls so the controls are in view (instant,
  nearest).
- The list and the controls each scroll vertically on their own; the
  drag-scroll rule above applies to both.
- Controls width: same as the old control stage, `min(760px, 100vw - 80px)`,
  minimum 520px.
- Portrait keeps the old layout: list in the zones panel, controls in the
  control stage below.

## Done means

- Landscape at 1920x1080 and 1280x800: sidebar at 184px with a 160px orb at
  scroll 0; at scrollX ≥ 400 it is 88px with a 64px orb, shadow in, buttons
  out, mini time/date in. Scrolling back restores the rest state.
- Home open with Bedroom selected shows list + Bedroom controls as one unit;
  Systems open with Climate selected shows list + climate controls as one unit.
- Portrait layout unchanged.
- Unit tests pass; deployed and checked live.
