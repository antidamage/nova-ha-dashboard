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
  theme's highlight colour, `--cyber-highlight` (alex, 2026-11-20), starting at 6
  o'clock (the bottom; alex, 2026-11-20) and running clockwise. **One colour** until it is too hot (below): no
  gradient and no graded warning colours. *Render check, 2026-11-14:* the first build used the accent slot
  `--cyber-line` and `--cyber-border-dim`; on the live theme those are
  `rgb(66 50 42)` and near-black, so the ring and number barely showed. The
  interview answer was "the theme's accent/LED token"; the LED slot was used
  until 2026-11-20, when alex asked for the highlight colour instead.
- **Fill: the part's hot temperature is 90% of the ring (alex, 2026-11-22:
  "a half- or three-quarter- full gauge flashing is going to seem like a false
  alarm. make it 90% fill to reach warning state").** Fill = temperature x 0.9
  / hot temperature, clamped 0–1 (`gaugeFraction`, `HOT_FILL`). A full ring is
  100 °C for a CPU and ~93 °C for a GPU; Iridium's GPU at 80 °C is 86%.
  `aria-valuemax` is that full-ring temperature.
- **Too hot: red, with a pulsing glow (alex, 2026-11-22: "the gauge fill
  should turn red and pulse a glow when it's too hot").** This replaces the heat
  notices the GPU guards used to post to the dashboard ("I'm getting heat
  warning notifications on nova. I don't want that."); the guards now log
  their warn and cap tiers and post only when they shed or stop work.
  - **Thresholds** (`HOT_CELSIUS`, `lib/host-temperatures/sources.ts`): a GPU
    from **84 °C**, the RTX cards' own temperature target (an RTX 2080 Ti on
    Iridium, which holds there under sustained load and slows down near
    88 °C); a CPU from **90 °C**, 5 °C under the Ryzen 9 3900X's 95 °C limit
    (Ununhexium; HWiNFO's Tctl/Tdie). Iridium's i7-5820K reads ~60 °C.
  - **Look:** the fill and the number take the extract's `--cyber-danger`
    (#ff405b). A `drop-shadow` glow in the same red goes from 0 to 6px and
    back, 1.2s each way (the extract's `xl` motion step), `ease-in-out`, for
    as long as the reading holds. With reduced motion the glow is a steady
    4px and does not pulse.
  - **Accessibility:** `aria-valuetext` gains ", too hot".
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
- **On its baseline, with room under it (alex, 2026-11-14, on the iPad:
  "don't line up. align them to their baseline" and "put some space below
  the slot ... too close to the panel edge"):** the gauges sit on the line's
  floor (`align-items: flex-end`) instead of floating in its middle, and a
  card holding the line has 12px (`--spacing-12`) of padding under it. The
  dial rows give that space up: `useSlotLayout` measures the row's content
  box, so padding is never counted as height the dials can have.
- **On the card's floor (alex, 2026-11-22).** The weather line and the
  gauges line are the card's last tracks and end at its 12px bottom padding;
  the dials are centred in the height above them, not the stack as a whole
  (specs/quick-access-card.md, "The lines sit on the card's floor").
- **Evenly distributed, with balanced padding (alex, 2026-11-21):** a flex
  row with `justify-content: space-evenly` inside 12px (`--spacing-12`) of side
  padding, so the space at each end equals the space between two gauges. The
  earlier equal grid columns left the ends half the inner gap.
- **One line tall, always (alex, 2026-11-21: the Ununhexium gauge was
  "appearing then being clipped off" in landscape and portrait).** Only the
  weather line grows to the card's width; the gauges line keeps
  `QUICK_WIDE_LINE` (56px). Before, every wide line took the weather's grown
  height, so after first paint the card's rows outgrew its box and the gauges
  were pushed past its bottom. `slotCounts` reports which lines grow
  (`grownLines`), and `quickSlotLayout` returns one height per line
  (`lineHeights`).
- **Per person (alex, 2026-11-21: "only show this set of temp gauges for
  alex"):** a home user's card never inherits the gauges from the shared
  card; they appear only on a card whose Quick Access list names the preset.
  The weather line is still inherited unless the list names its own, and
  inherited lines sit before the person's own, so the gauges stay the bottom
  line.
- **The slot model as it is.** Every module that is not a dial already takes
  its own wide line track in slot order (`panelSlots.ts` `wideBottom`:
  `wide = count - dials`, and `slotGrid.ts` adds one track per wide slot). So
  placing the gauges slot after the weather slot is what makes it the next
  line. The added row takes one line (56px) plus a gap out of the card's
  height, and the dial rows share what is left.
- **Not scaled with the weather line.** When the weather line is shrunk,
  every wide slot takes its factor (`--wide-scale`). The gauges slot opts out
  of that transform. Its row shrinks its gauges rather than overflowing the
  slot, so the slot measures as fitting and the weather's factor is left
  as it was.

## Live configuration (data, not source)

The live dashboard gets one preset, **Host temperatures**, with sources
`Ununhexium=<its host-metrics /flat URL>` and `Iridium=<its host-metrics /flat
URL>`, named in alex's home-user Quick Access list only (2026-11-21; it
was on the shared slot list after Outside Weather until then).
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
