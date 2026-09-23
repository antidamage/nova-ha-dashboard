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
  520px column with its four segments stacked in their usual order.
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

- **One slot width for the whole card.** Every module placed on the card — a
  lighting dial, the amplifier dial, a climate knob, the readings tile — takes
  one slot, and every slot is the same width. Before this each slot was sized
  to its own content: the ring-less pair took half a line each, a climate knob
  reserved its rings' reach, the readings tile took the whole width. Three lines
  could hold three different slot widths, and nothing lined up with anything.
- **Lines, then slots.** The card is still a stack of lines — the dial line, the
  climate knobs, the readings — because that is the reading order a module
  declares (`region`: `dial-line`, `climate`, `readings`). Slot order decides
  position within a line. Each line is a centred, wrapping row of equal slots,
  and a module still never invents a fourth line: that would need a matching
  stylesheet (specs/control-modules.md).
- **The width, the gap and the dial size are measured, not styled.**
  `useQuickSlotLayout` reads the card's own width (ResizeObserver) and
  `quickSlotLayout` in `quick-access/dial-model.ts` returns one slot width, the
  gap between slots and the dial size. A slot is at least the widest thing
  placed in it needs; the card then puts as many slots on a line as that
  minimum allows; the slots take the rest of the width between them, so a full
  line reaches both edges of the card and a short line (the readings, and every
  line on a phone) is centred.
- **The gap is a share of a slot** — `QUICK_SLOT_GAP_RATIO` (5%), floor
  `QUICK_SLOT_GAP_MIN` (8px), ceiling `QUICK_SLOT_GAP_MAX` (28px) — so a slot
  that has been scaled up to fill its line takes its spacing up with it instead
  of the card reading as wide slots with pinched gaps. The lines are spaced by
  that same measure, so the gap inside a row and the gap between rows agree.
- **The minimum is a knob's rings in portrait, a dial's box in landscape.**
  Portrait must keep a knob's floating rings on screen, so its slot reserves the
  widest knob's ring reach (`quickDialSlot`, `ringGeometry(size, 4, true)`);
  landscape's rings are free to float over the page, so its slot only has to
  hold the dial's titled box (`quickDialBox`). That is why a landscape line fits
  two slots where a phone fits one.
- **Content is top-aligned in its slot, and centred across it.** A slot is as
  tall as its line's tallest control, and the dial, its title arc and its preset
  row start at the same height in every slot on the line — before this, a control
  sat in the middle of whatever box its line happened to give it. Across the slot
  a control is **centred** (Adeline, 2026-09-23): the width a slot has beyond its
  control is shared equally either side of it, never left over at the right,
  which is what the old left-packed tile did (~~everything clusters from the
  left, any spare width is left over at the right~~, Adeline 2026-09-11,
  superseded). The readings tile is not a control and keeps its own
  arrangement.
- **What one width costs, stated plainly.** A ring-bearing knob's portrait slot
  is ~300px at 133px, more than half a 375px card, so **a phone holds one slot a
  line** and the card is five lines tall there — the lights, the amplifier, each
  climate knob and the readings tile, one under the other, all the same size. A
  1080px portrait screen and the kiosk hold two. The readings tile is one slot
  like any other, so it no longer stretches across the card: it is centred in a
  line of its own.
- **Checked by `e2e/quick-access-slots.spec.ts`** at 1920×1080, 1080×1920,
  820×1180, 440×956 and 375×812: one width for every slot, the rows filled edge
  to edge, a short row centred, the columns of one row directly above the next,
  an even gap, top-aligned content, and the gap growing with the slots.
- Tile height is 84px, set by the original colour encoder footprint (a 56px
  dial is 74px across, the unlock ring's 1.314 ×). A tile only grows past that
  when its controls wrap — the lighting segment always does, since its dial's
  box is 104px across and its presets sit beneath it (2026-09-12).
- ~~One row of four segments, left to right: **Lights · Lounge · Bedroom ·
  Outside**, measured natural widths of ~1,575px with gaps, and three layouts
  chosen by container query on the card's own width (>=1480px one line,
  920-1479px 2×2, <920px one tile per row).~~ Superseded twice: the dials became
  two lines on 2026-09-22, and the lines became measured rows of equal slots on
  2026-09-23. "Never a horizontal scrollbar, never a segment cut in half" still
  holds — the measured slot width is what enforces it now.

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
- **A slot holds a dial's box, or its rings in portrait.** `quickDialSizeFor`
  only has to fit the widest knob's ring slot inside the card now that every
  slot is the same width and a line never forces two dials to share it: a phone
  whose card cannot hold two ring-safe slots puts one slot on a line instead of
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
