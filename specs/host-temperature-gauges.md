<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Host temperature gauges

alex, 2026-11-14 (ticket 523927):

> we're going to need temperature monitors for ununhexium and iridium on the
> dashboard. copy the rainmeter circular gauge style - one colour, circular
> ring, relatively thick, temp listed in the middle. put them on the quick
> access panel but make them small. create a new horizontal slot at the bottom
> below temperature for them, distribute them evenly in it.

Interview answers (2026-11-14): CPU **and** GPU for each host (four gauges for
two hosts); the colour is the dashboard **accent**, not the Rainmeter lime;
Ununhexium's CPU reading comes from HWiNFO (enabled by the agent).

## The module

A control module, **Host Temperatures** (`host-temperatures`, renderer
`temperature-gauges`, category Environment). It is not a dial, so on the Quick
Access card it takes a wide line slot of its own (specs/quick-access-card.md,
"The layout slots").

- **Binding: `metricSources`**, a token list. Each entry is `Label=URL`: a
  short label shown under that host's gauges, and the URL of a host-metrics
  `/flat` endpoint (`host-metrics/specs/host-metrics-api.md` in the workspace
  repo). Order is the gauges' order. Which machines, and where they are, is
  configuration only: no hostname, address or port appears in source
  (golden rule: no machine-specific code).
- **Readings per source:** `temp.cpu.celsius`, then `temp.gpu.celsius`
  (`temp.gpu.N.celsius` for each GPU when a host has several). A source that
  publishes no temperature columns contributes no gauges. A source that cannot
  be reached keeps its gauges with an empty ring and `--`, so the row does not
  re-flow when one machine is asleep.
- **Features:** none. **Placeable:** yes. Not derived for a home that has
  never configured presets: a household with no host-metrics endpoint would
  get an empty row.

## Data path

`GET /api/host-temperatures` on the dashboard server. It reads the
`metricSources` of every Host Temperatures preset in the current control
configuration, fetches each distinct URL server-side (2 s timeout, result
cached 5 s), and returns `{ sources: [{ url, label, ok, readings: [{ key,
celsius }] }], at }`. The browser never fetches a host directly: the dashboard
is served over HTTPS and host-metrics is plain HTTP on the LAN/tailnet, and the
server is the one place guaranteed to reach both. Only URLs present in the
saved configuration are fetched, so the route cannot be used to reach anything
else (no URL comes from the request).

The segment polls the route every 5 s while the page is visible, and pauses
while hidden. A value is shown rounded to whole degrees.

## The gauge

Copied from alex's Rainmeter skin (CSM "Overview-4Gauge", `Roundline` with
`LineStart=50`, `LineLength=35` in a 120 box):

- **A filled ring:** outer radius 50 and inner radius 35 in a 120 viewBox, so
  the band is 30% of the radius ("relatively thick"). The extract has no
  ring-thickness value, so this is the Rainmeter geometry alex asked to
  copy. The track is the full circle in the card's reading colour
  (`--cyber-title-on-bg`) at 18%, the skin's faint track. The fill is the
  theme's lit colour, `--nova-led-color` (the knob LEDs' slot), starting at 12
  o'clock and running clockwise. **One colour**: no gradient and no warning
  colours. *Render check, 2026-11-14:* the first build used the accent slot
  `--cyber-line` and `--cyber-border-dim`; on the live theme those are
  `rgb(66 50 42)` and near-black, so the ring and number barely showed. The
  interview answer was "the theme's accent/LED token", and the LED slot is the
  one that reads as lit.
- **Fill = temperature / 100 °C**, clamped 0–1. Because one colour carries no
  warning, the fill and the number are the whole signal, and the scale is
  fixed so that 85 °C always looks the same.
- **The number in the middle:** whole degrees with a `°`, 0.7rem, weight 900,
  monospace (`--cyber-mono`), in the card's reading colour
  (`--cyber-title-on-bg`, as the skin's white text), inside the ring's ~28px
  hole.
- **Caption under the ring:** the source label and the part, e.g.
  `IRIDIUM CPU`, using `.quick-stepper-caption` (0.7rem mono 900,
  `--cyber-muted`), one line, with an ellipsis if it does not fit.
- **Small:** the ring is 40px across at the line's natural size (ring 40 +
  gap 3 + caption 11 = 54px, inside the 56px `QUICK_WIDE_LINE`). It never
  grows past 40px. On a narrow card the row's columns shrink, and the ring
  shrinks with them (`min(40px, 100%)`), rather than wrapping.
- **States:** no reading → `--` with the track only. A source that answered
  `ok: false`, or no successful poll for 15 s → the gauge dims (opacity .45)
  and keeps its place. The row never re-flows because one machine is asleep.
- **Read-only:** not focusable, no hover or tooltip, no tap action.
  `role="meter"` with `aria-valuemin=0`, `aria-valuemax=100`,
  `aria-valuenow`, `aria-valuetext` ("85 degrees") and `aria-label`
  ("Iridium CPU").
- **Reuse:** no small ring or meter component exists in the dashboard (the
  rotary rings in `rotaryEncoderGeometry.ts` are the knob's, with thumbs and
  LEDs), so the gauge is a small SVG of its own.

## The row

- **Its own line, below the weather line.** The slot is placed after the
  Outside Weather slot in the Quick Access slot list, and every module that is
  not a dial takes its own full-width line track in slot order, so the gauges
  line is the bottom row. With the module not placed, nothing changes: no
  element, no track.
- **Evenly distributed:** the gauges spread across the line's full width with
  equal space around each (equal grid columns).
- **The slot model as it is.** Every module that is not a dial already takes
  its own wide line track in slot order (`panelSlots.ts` `wideBottom`:
  `wide = count - dials`, and `slotGrid.ts` adds one track per wide slot). So
  placing the gauges slot after the weather slot is what makes it the next
  line. The added row takes one line (56px, or the weather line's grown
  height) plus a gap out of the card's height, and the dial rows share what is
  left.
- **Not scaled with the weather line.** When the weather line is shrunk,
  every wide slot takes its factor (`--wide-scale`). The gauges slot opts out
  of that transform. Its row is a grid of equal columns that cannot overflow
  the slot, so the slot measures as fitting and the weather's factor is left
  as it was.

## Live configuration (data, not source)

The live dashboard gets one preset, **Host temperatures**, with sources
`Ununhexium=<its host-metrics /flat URL>` and `Iridium=<its host-metrics /flat
URL>`, placed in the Quick Access slot list directly after Outside Weather.
That is runtime configuration written through the config API, not a commit.

## Done means

- Four gauges on the live Quick Access card (Ununhexium CPU, Ununhexium GPU,
  Iridium CPU, Iridium GPU), in a line below the weather line, evenly spread,
  readings matching each host's `/flat` within one poll.
- Rendered and compared on the live build at desktop landscape, iPad landscape
  and phone portrait.
- An unreachable source shows `--` gauges, and the row keeps its shape.
- Unit tests: the module and preset validation, the route's parsing of a
  `/flat` document, the gauge's fill and label maths, and the row's layout
  (the gauges slot is a wide slot after the readings, and does not take part
  in the weather line's scale).

Produced by: the interactive session working ticket 523927 (no plan file; the
plan is the `PLAN:` comment on the ticket).
