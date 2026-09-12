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

## Single line

- One row of four segments, left to right: **Lights · Lounge · Bedroom ·
  Outside**. Each segment is its own bordered tile with a gap between, rather
  than a shared hairline divider *(decided)* — tiles are what wrap cleanly when
  the row breaks, and they match the boxed zone buttons below.
- Within a tile, everything clusters from the left: the buttons sit beside
  the control they belong to — the lights dial, the climate stepper — not
  pinned to the tile's right edge. Adeline, 2026-09-11 (previously pinned
  right); any spare width is left over at the right.
- Measured natural widths (demo, all four segments): lights ~340px, aircon
  ~442px, heater ~423px, outside ~313px — about 1,575px with gaps. With 44px
  touch targets that does not fit a tablet, so the row has three layouts,
  chosen by container query on the card's own width *(decided)*:
  - **≥1480px card** (1920px kiosk, desktop): one line, no wrapping.
  - **920–1479px** (iPad landscape): 2×2 grid of whole tiles.
  - **<920px** (portrait, phone): one tile per row; a tile's own controls
    may wrap to a second line inside it.
  Never a horizontal scrollbar, never a segment cut in half.
- Tile height is 84px, set by the colour encoder footprint (56px dial ×
  1.244). A tile only grows past that when its controls wrap on a phone.
- **The climate knobs are not tiles (Adeline, 2026-09-12, later the same day).**
  A 100px knob's dial is about 124px across — half again as tall as a tile's
  row — so a boxed one spilled past its own border and overlapped the tile
  below in the landscape grid, tucked or not. Both knobs sit inline in one
  `quick-climate-row`, each under its own label, with no border or background
  of their own. Same arrangement in landscape and portrait. Their rings float
  over the page and take no layout space.
- The landscape grid sizes its rows `minmax(max(84px, min-content), 1fr)`: a
  bare `84px` minimum replaces the automatic content-based one, which is what
  let a taller row overflow its track in the first place.
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
  brightness) are applied server-side by `setZoneAction` in `lib/ha.ts`. The
  card sends the same actions the zone card sends, so those rules apply
  unchanged.
- The encoder's displayed value follows the Home zone the same way the zone
  card does (`spectrumFromZone`, `spectrumCursors.everything`, the
  `useRemoteSetting` hold), so a change from the zone card, voice, or HA shows
  up here and vice versa.
- Segment label: the Home zone's name ("Home"), with the lights-on count
  beneath it ("3 on" / "Off") *(decided)*.

## Climate segments (Lounge, Bedroom)

**Superseded 2026-09-12 (Adeline):** each climate segment is now the **title
above a 100px `TemperatureEncoder`**, with the same rings as the full card
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
- Existing unit tests pass (`npm run test:unit`, `npm run test:aircon`),
  `tsc`/`next build` clean, new unit tests for the state-label helpers.
- Visual review passed by adversarial reviewers against real renders at
  wide landscape, iPad portrait and phone widths, in the demo harness.
- Deployed with `deploy-nova-stack.ps1` through the task log.
