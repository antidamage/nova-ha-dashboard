# Quick Access — the one-line home card

Adeline, 2026-09-10. A compact, single-line card that puts the controls used
most often in one place, above the zone menu, without opening a zone.

Adeline asked for no interview ("no user questions just do it"), so every
decision below that she did not state was made by the implementing agent and
is marked *(decided)*. Change them here, in place.

Produced by: interactive Claude Code session, 2026-09-10 (no plan file; the
request was executed directly).

## Placement

- Named **Quick Access**. The name is shown on the card as its kicker.
- Sits **above the zone menu** (`ZonesPanel`) and **below the reminder icon
  bar**, and reads as distinct from the panels below it: its own border and a
  highlight-coloured left rail *(decided)*, with the normal layout gap under it.
- Landscape begins when the viewport is wider than it is tall. The page is a
  horizontally scrolling row of top-aligned columns, centered vertically:
  clock/reminders, Quick Access, zones, selected controls. Quick Access is a
  520px column holding the card's grid of slots (below).
- Square and taller windows keep the vertical order: clock, reminders, Quick
  Access, zones, control stage. Mouse dragging and native touch scrolling move
  the page; landscape also maps the mouse wheel to horizontal movement outside
  controls and vertically scrolling panels. Scrollbars are hidden.

- Nova Classic design only *(decided)*. The Plain design reuses `ZoneControls`
  but has its own chrome; it does not get the card in this change.

## The layout slots

Adeline, 2026-09-23, rewrote how the card lays out the modules placed in it:

> tidy up the layout slots the modules go into by making them all the same size
> and evenly spaced and distributed... controls placed in this area should align
> to the top of their individual space, and otherwise flow like a centre-aligned
> grid. once items have flowed into the minimum allowable space, they should
> scale up a bit to fit the available area, but with some proportional spacing
> in between.

Adeline, 2026-09-25, made the arrangement a defined thing rather than whatever
fits in a row:

> the panel will be defined as having (default in the case of maximum room
> available) either 1x4, 4x1 or 2x2 slot arrangements. these slots will evenly
> subdivide the space available. inside the slots the content will be centre-top
> aligned, and will scale up or down to fit in the slot... on desktop, it will be
> 2x2 until the window gets under a certain size. on an ipad pro 12.9" it will be
> 2x2. on iPhone it will become 4x1 or 1x4, depending on the screen orientation...
> in all cases except mobile phone we always want all panels on screen at once.
> it will be up to the user to ensure they don't over-pack it.

- **The card is a grid of equal slots, one per module placed on it**, in the
  order the slots are configured in. It was the FIRST panel to hold slots and
  every other dashboard panel now does the same (Adeline, 2026-09-25;
  specs/control-modules.md, "Every panel holds slots"): the grid, the item view
  and the measurement live in `app/components/dashboard/panel-slots/`, the card
  uses them, and a panel's own content is a `panel-content` module it hands to
  its slot. A module's declared `region` no longer
  places it: the card is not a stack of lines any more, so the position of a
  module is its slot's order and the arrangement below.
- **The arrangement is the panel's own while the panel has room for it.**
  `app/components/dashboard/panelSlots.ts` is the rule — `balancedColumns` and
  `panelSlotGrid` — and the card passes it its own measured box and the number of
  modules placed on it. The balanced arrangement is the grid: **2x2 for four
  slots, 3x2 for five, 3x3 for seven to nine**; two or three modules are one line
  along the panel's long axis (Adeline, 2026-09-25: "if there are two components,
  follow the same rules for a 1x2 or 2x1 area depending on layout orientation.
  continue this pattern"). It gives up a column at a time while a slot would come
  out narrower than the panel's own minimum, which is the whole of what decides
  the phone. On the shipped card:
  - **Four modules are the 2x2 Adeline named**, on a desktop, a kiosk and an iPad
    Pro 12.9 alike.
  - **The five modules the demo places are 3x2.** The card is a 520px column of
    the landscape layout, and 2x3 cannot be laid out in that column's 600px
    height at the knob's own 100px floor — three rows of knobs need 3 × 211.4 +
    2 × 12 = ~658px — so the balanced grid that *does* fit is the one used. Five
    knobs at the old fixed 133px fit neither way round (they need 3 × 257.3 +
    2 × 12 = ~796px of height in two columns, or ~636px of width in three), which
    is why the dial size is derived from the slot rather than fixed.
  - **A tablet's portrait width holds three columns** where the card is ~1000px
    wide and two at 820px.
  - **A phone in portrait holds one column** — five rows — because two
    ring-bearing knobs side by side would run their opened rings off the screen.
    A phone in landscape gets as many columns as its 520px column allows (three);
    five across needs 867px and is never drawn.
- **The slots subdivide the panel.** The columns divide the card's width between
  them with the proportional gap, so a full row reaches both edges; in landscape
  the rows divide the column's own height between them
  (`grid-auto-rows: minmax(min-content, 1fr)`), so the grid fills the panel in
  both directions. Portrait has no height to divide — the card is as tall as its
  content and the page scrolls under it, which is what a phone does.
- **The content is centred across its slot and starts at its top** (Adeline,
  2026-09-25: "centre-top aligned"). A dial's left and right gaps to its slot's
  edges are equal, and every dial starts at the same height within its own slot
  rather than floating in the middle of it.
- **The content scales to its slot.** `quickDialSizeForCell` returns the largest
  dial that fits the slot's width (a knob's rings in portrait, its titled box in
  landscape) and its height (`quickSlotHeight`), never below the temperature
  knob's 100px floor and never above the controls' own 200px ceiling. So a 2x2
  card draws bigger dials than the old fixed 133px, a card that must fit five
  knobs into a kiosk column draws the floor size, and every dial on the card is
  still one size. The readings tile is one slot like any other and is not scaled:
  it reflows its own readings.
  - **The height is the tallest slot kind's, and a climate knob is that kind.**
    `quickSlotHeight` is the dial's box plus the gap plus the WHOLE preset band,
    because a knob reserves its band as a spacer with nothing taken back
    (`.quick-climate::after`); only the preset tiles give the box's lower title
    band back as a negative margin. Measuring a tile's pulled-back band instead
    under-budgeted every knob by ~18px, and the first version of this shipped a
    2x2 card whose content came to 619px inside its 598px column — with the
    scrollbar hidden, so the arrangement Adeline named for a desktop was quietly
    cut off. Found by the independent review of PR #50, measured in Chromium, and
    `e2e/quick-access-slots.spec.ts` now asserts the card fits its column rather
    than only that its rows are equal while it does.
- **A short last row fills from the first column.** Five slots in three columns
  are two rows, and the second row's two slots sit under the first two columns —
  the columns of one row line up with the row above, which is what the one slot
  width is for. (This replaces "a short row is centred", Adeline 2026-09-23,
  which was about lines rather than a grid.)
- **The gap is a share of a slot** — `PANEL_SLOT_GAP_RATIO` (5%), floor
  `PANEL_SLOT_GAP_MIN` (8px), ceiling `PANEL_SLOT_GAP_MAX` (28px) — so a slot
  that has been scaled up to fill its row takes its spacing up with it instead of
  the card reading as wide slots with pinched gaps. The rows are spaced by that
  same measure, so the gap inside a row and the gap between rows agree.
- **The card fits its column.** Adeline, 2026-09-25: "in all cases except mobile
  phone we always want all panels on screen at once. it will be up to the user to
  ensure they don't over-pack it." A card whose slots cannot all fit — more
  modules than the column has room for at the knob's floor size — grows its rows
  past their even share and scrolls, and that is the user over-packing it; a
  phone in landscape is the one case where a scroll is the answer rather than a
  fault. The card never draws a horizontal scrollbar: a row that cannot hold its
  slots gives up columns instead.
- **What one slot width costs, stated plainly.** A ring-bearing knob's portrait
  slot is ~300px at 133px, more than half a 375px card, so **a phone holds one
  slot a row** and the card is five rows tall there — the lights, the amplifier,
  each climate knob and the readings tile, one under the other, all the same
  size. A 1080px portrait screen holds three, and the kiosk three.
- **Checked by:** `panelSlots.test.ts` (the arrangement rule: the balanced grid,
  the line for two or three, the phone's one column, the panel filled exactly),
  `dial-model.test.ts` (the slot's width, the dial a slot gets, the height it is
  fitted to, the floor), and `e2e/quick-access-slots.spec.ts` (the shipped
  five-module card at eight viewports — one slot width, rows filled edge to edge,
  content centred and top-aligned, one dial size, the card FITTING its column
  wherever it is meant to, no horizontal overflow — plus a four-module card,
  which is the 2x2 and is the case that found the short measure). `e2e/quick-access-portrait.spec.ts` keeps the rings-on-screen and
  preset-row checks; `e2e/quick-access-layout.spec.ts` keeps the preset row
  hugging its dial and checks the first row.
- Tile height is 84px, set by the original colour encoder footprint (a 56px
  dial is 74px across, the unlock ring's 1.314 ×). A tile only grows past that
  when its controls wrap — the lighting segment always does, since its dial's
  box is 104px across and its presets sit beneath it (2026-09-12).
- ~~One row of four segments, left to right: **Lights · Lounge · Bedroom ·
  Outside**, measured natural widths of ~1,575px with gaps, and three layouts
  chosen by container query on the card's own width (>=1480px one line,
  920-1479px 2×2, <920px one tile per row).~~ Superseded three times: the dials
  became two lines on 2026-09-22, the lines became measured rows of equal slots
  on 2026-09-23, and the rows became the grid above on 2026-09-25.

- A segment whose device is absent in this home is **not rendered** (same rule
  as `ClimateControls`: no empty card for a room the home does not have).


## Lights segment

Controls the **Home** zone (`id: "everything"`). That zone already excludes
outside lighting through `homeAssistant.everythingExcludedEntityIds`
(`light.outside_light`, `light.tuya_mobile_outside_light` in this home), so
"all lights except outside" is the Home zone. No new server code.

- **One colour control**: `ColorEncoder` at `size={56}` *(decided; component
  range 50–200)*, channels hue / brightness / saturation, the same binding the
  zone card uses (hue + saturation → `rgb_color` at full value; the brightness
  light → zone `brightness_pct`). Commits go through `POST /api/zone` with the
  Home zone id, exactly as the zone card's encoder does.
- **Two preset buttons**: Candlelight and Off.
  - Candlelight sends zone action `candlelight` with the adaptive brightness
    and spectrum (`candlelightBrightnessPct(sun)`,
    `adaptiveCandlelightSpectrum(sun)`), and its label is the adaptive label
    (`adaptiveCandlelightLabel(sun)` — "Candlelight" after sunset, "Daylight"
    by day), identical to the zone card's button *(decided: the two cards must
    not disagree about what the same button does)*.
  - Off sends zone action `off`.
- **Rules followed, not re-implemented.** Per-light overrides
  (`dashboard.lighting.entityPresets`: pinned lights, per-entity brightness
  targets, colour-temperature overrides) and the night-time colour and
  brightness rules (`sun.sun` below horizon → candlelight at the evening
  brightness) are applied server-side by `setZoneAction` in `lib/ha/lighting/zone-action.ts`. The
  card sends the same actions the zone card sends, so those rules apply
  unchanged.
- The encoder's displayed value follows the Home zone the same way the zone
  card does (`spectrumFromZone`, `spectrumCursors.everything`, the
  `useRemoteSetting` hold), so a change from the zone card, voice, or HA shows
  up here and vice versa.
- ~~Segment label: the Home zone's name ("Home"), with the lights-on count
  beneath it ("3 on" / "Off")~~ **Gone 2026-09-12 (Adeline): no written title
  and no count.** The dial and the two preset icons are the whole segment; the
  zone's name is still the group's `aria-label`, so the segment is still named
  for assistive tech. `lightsOnLabel` stays in `quickAccessModel.ts`, tested
  but now unused by this card.
- **Stacked and icon-only (Adeline, 2026-09-12, later the same day).** The
  lighting segment is the one segment that reads top-to-bottom rather than
  left-to-right: the dial is centred, and the two preset buttons sit centred
  beneath it (`.quick-segment-lights`). The dial is **the same size as the
  climate dials** — `QUICK_ENCODER_SIZE = QUICK_TEMPERATURE_SIZE`, 133px — so
  the three read as one set. It went 56 → 84 (once the title went) → 133
  (Adeline, 2026-09-12, when the three were put on one line). The presets are the icon
  alone — no written label — on a square 44px button (`quick-button-icon`,
  `QuickButton`'s `iconOnly`). The label is not lost, only unwritten: it is
  still the button's `aria-label`, and Candlelight's stays adaptive, so
  assistive tech reads "Daylight" or "Candlelight" as before.

## Climate segments (Lounge, Bedroom)

**Superseded 2026-09-12 (Adeline):** each climate segment is now the **title
above a 133px `TemperatureEncoder`** (100px at first; raised a third later the
same day, because at the floor the knobs read as small beside the rest of the
line), with the same rings as the full card
floating over the page (`specs/temperature-encoder.md`). It carries no tile
border or background — see the layout rules above. The current
temperature, the state word, the − / + stepper and the Auto / Off buttons
below are gone; the knob shows the target, the room temperature and the mode.
The shared-hook rules in this section still apply. The original list is kept
below as history.

Two separate segments, greatly reduced versions of the full cards. Each had
only:

1. **Title** — from config (`dashboard.aircon.title`,
   `dashboard.bedroomHeater.title`), same resolver as the full cards.
2. **Current temperature** — the room's measured temperature
   (`airconAutoMeasuredTemperature` for the aircon, the bedroom sensor for the
   heater).
3. **Current state** — one short word or pair:
   - Aircon: `Off` when the power selection is Off; otherwise the unit's
     activity: `Heating` / `Cooling` / `Fan` / `Dry` when running, `Idle` when
     Auto is resting at homeostasis. Manual shows as `Manual · <activity>`,
     because Manual has no button on this card *(decided)*.
   - Heater: `Off` when the mode is Off, else `Heating` when the switch is on
     and `Idle` when it is not.
   - `Unavailable` when the entity is `unavailable`/`unknown`.
4. **Target temperature with − / + controls**, 1° steps, disabled when the
   room is Off (matches the full cards). Heater clamps to
   `BEDROOM_HEATER_MIN/MAX_TARGET_C`.
5. **Auto / Off** buttons. The active one is highlighted with the same
   highlight treatment as the full cards' state buttons. For the aircon,
   Manual lights neither.

No timers, fan speed, mode buttons, fresh air, humidity or module slots.

**One command instance per room, shared.** Both surfaces are on screen at once
whenever the Climate zone is open. A hook instance each was not enough: the
press-intent hold only existed in the component pressed, two setpoint debounces
could overwrite each other from stale bases, and the heater's last-request-wins
guard became per-component — so an Auto here and an Off there resolved by
whichever response landed last, which is exactly the failure
`specs/bedroom-heater-control-integrity.md` closes. `ClimateCommandsProvider`
therefore creates one instance of each hook and both surfaces consume it
(`useSharedAirconCommands`, `useSharedBedroomHeaterCommands`, which fall back to
a local instance where no provider is mounted, as in the Plain design).

**Command logic is shared, not copied.** The aircon's power-intent
resolution, Auto arming (`buildAirconAutoActions` with the fallback),
Off, and the 2-second debounced `set_temperature`; and the heater's
server-truth mode/target handling, last-request-wins sequencing, 8-second
save timeout, debounced target save and discard-on-hide — all move into
hooks (`useAirconCommands`, `useBedroomHeaterCommands`) that both the full
cards and the compact segments call. The full cards' behaviour must be
unchanged by the extraction. See `specs/aircon-auto-control.md` and
`specs/bedroom-heater-control-integrity.md` for the rules those hooks carry.

A heater Off from the compact card clears a running sleep timer, as the full
card's Off does.

## Outside segment

From `DashboardState.weather`:

- Condition label (`weatherLabel(condition)`). That helper now humanises Home
  Assistant's ids ("partlycloudy" → "Partly cloudy", "clear-night" → "Clear")
  instead of only swapping underscores, so this card and the full weather panel
  cannot show different words for the same live condition.
- **Temperature** (1 dp) and **Feels like** (1 dp), both in degrees.
- **UV** — the current `uvIndex` (1 dp).
- Weather unavailable: the segment still shows, with `--` values.
- **Stacked and centred (Adeline, 2026-09-12, later the same day).** Like the
  lighting segment, the Outside segment reads top-to-bottom: the condition icon
  and its title centred, and the three readings centred beneath them in one row
  of their own (`.quick-weather-readings`, so a column layout does not put each
  reading on its own line).

## Round: two dial lines, and the Apple TV (Adeline, 2026-09-22)

The card's dials are **two lines**: the lighting dial and the amplifier dial
share the first, the two climate dials keep the line below them, and the weather
follows on its own. The layout lives in `app/styles/dashboard/quick-access-dials.css`
and the dial sizes in `quick-access/dial-model.ts`.

- **The amplifier dial** is its own segment, `QuickAppleTVSegment`, built like
  the lights one: the dial and its preset row under it, the tile border dropped
  in portrait. It is the placeholder for the IR emitter that will drive the
  amp's volume and power — see [apple-tv-volume.md](apple-tv-volume.md) — and
  its three preset buttons are the Apple TV's playlists.
- **The dial line holds the lighting dial and the amplifier dial.** Both are
  ring-less, so nothing there needs the portrait ring reserve; both are still
  one slot wide, like every other module on the card.
- **A slot holds a dial's box, or its rings in portrait.** `quickDialSizeForCell`
  only has to fit the widest knob's ring slot inside the card now that every
  slot is the same width and a row never forces two dials to share it: a phone
  whose card cannot hold two ring-safe slots puts one slot on a row instead of
  shrinking the dials to fit two. A 375px viewport keeps 133px dials and one
  slot a line; a 300px one shrinks them (to ~106px on the demo's row, measured in
  Chromium). `e2e/quick-access-portrait.spec.ts` asserts the rule the figure comes
  from — the dials shrink together but never below the temperature knob's 100px
  floor — rather than the figure, which moves with the card's padding.

- **Each preset row hugs its dial.** A titled dial's box reserves the title's
  band above *and* below the knob; the row takes the lower half back, which is
  what had been holding the buttons a knob-slack away from the dial that owns
  them (23px → 8px here, a 200px panel dial 58px → 20px). See
  [dial-preset-band.md](dial-preset-band.md).

## Reuse

- `QuickAccessCard` — `app/components/dashboard/QuickAccessCard.tsx`. Props
  only (zones, climate devices, preferences, weather, sun, command
  callbacks); it reads no dashboard globals, so another surface can mount it.
- Each segment is its own exported component (`QuickLightsSegment`,
  `QuickAirconSegment`, `QuickHeaterSegment`, `QuickWeatherSegment`) so a
  surface can take a subset.
- Buttons use `MomentaryFeedbackButton` (control sound and press feedback);
  the colour control is `ColorEncoder`. No native controls.
- Zone actions for a zone other than the selected one:
  `useDashboardCommands` gains `applyZoneActionFor(zone, action, body)`;
  the existing `applyZoneAction` becomes the selected-zone wrapper around it.
- Listed in `nova-ha-dashboard/CLAUDE.md`'s component inventory.

## Done means

- Card renders above the zone menu in every layout, one line on a wide
  landscape screen, wrapping cleanly on phone and portrait.
- Candlelight / Off / colour change the Home zone and leave outside lights
  alone; night rules and per-light overrides visibly apply (server path).
- Auto / Off / target on each climate segment behave exactly as the full
  card's controls do, and both stay in agreement when both are on screen.
- Every slot on the card is the same width, the rows are filled and centred,
  the columns of one row sit directly above the next, and each control starts at
  the top of its own slot (2026-09-23).
- Existing unit tests pass (`npm run test:unit`, `npm run test:aircon`),
  `tsc`/`next build` clean, and new unit tests cover the slot width, the gap and
  the dial sizes (`quick-access/dial-model.test.ts`).
- Visual review passed by adversarial reviewers against real renders at
  wide landscape, iPad portrait and phone widths, in the demo harness.
- Deployed with `deploy-nova-stack.ps1` through the task log.
