# TemperatureEncoder — the climate knob

Adeline, 2026-09-12. A temperature knob built on the same dial as the lighting
knob. It replaces the body of the aircon and bedroom-heater cards and the
Quick Access climate segments.

Plan: `~/.claude/plans/let-s-make-a-new-floofy-papert.md`. The interview
answers below are Adeline's. Items marked *(decided)* were the planning or
implementing agent's call and can be changed here in place.

The dial itself — layers, drag, clicks, rings, tuck-away, floating rings — is
the shared `RotaryEncoder` base, specified in `specs/color-encoder.md`. This
file covers only what the temperature knob adds and how the climate cards use
it.

Files:

| | |
|---|---|
| `app/components/TemperatureEncoder.tsx` | the knob |
| `app/components/temperatureEncoderModel.ts` | colour scale, split ring paint, timer and fan text |
| `app/components/dashboard/ClimateKnobs.tsx` | `AirconKnob` and `HeaterKnob`: the shared climate hooks mapped onto the knob |
| `app/components/dashboard/climateCommands.ts` | the command hooks the knobs call (shared, one instance each via `ClimateCommandsProvider`) |
| `app/temperature-encoder/page.tsx` | demo page, fake devices, commands never sent to Home Assistant |
| `app/color-encoder-rings/page.tsx` | the existing sample page also gets a sample temperature knob, aircon-style with all four rings and fake state (Adeline, 2026-09-12: a sample knob rather than a row of sample rings) |

## Light/dark skin

The knob follows the theme's knob-skin setting exactly as the colour knobs do,
because `RotaryEncoder` reads it off `<html data-knob-skin>` itself — see
"Knob skin override" in `specs/color-encoder.md`. `TemperatureEncoder` passes
its optional `knobSkin` prop straight through and must not default it
(Adeline, 2026-09-12: the temperature controls were ignoring the setting).

## Size

`size` is the knob diameter, **100–200px** (the lighting knob keeps 50–200).
200px on the full climate cards, 100px in Quick Access.

## The knob sets the target, and only the target

Whatever the mode, turning the knob changes the target temperature. Modes no
longer change what the knob does.

- Step **0.5°C** (Adeline).
- Range: the aircon entity's `min_temp`/`max_temp`, falling back to 16–30°C;
  the heater's `BEDROOM_HEATER_MIN_TARGET_C`–`BEDROOM_HEATER_MAX_TARGET_C`
  (5–30°C).
- The index runs 7:30 → over the top → 4:30 across the range, so the value
  moves at `range / 270°` per degree turned. The drag is relative, as on every
  dial.
- The value previews while turning and commits on release, through the
  existing debounced setpoint sends (`AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS`).
- Keyboard arrows step 0.5°C.

## LEDs are the modes

| Device | LEDs, left to right |
|---|---|
| Aircon | **Auto, Manual, Off** |
| Heater | **Auto, Off** (Adeline: the heater has no Manual; it was retired in August 2026) |

- The lit LED is the resolved power state: server truth plus the existing
  press-intent hold in `useAirconCommands`, and the server's mode for the
  heater.
- **A tap cycles the LEDs and wraps.** The LED moves on each tap. The command
  for the mode the LED ends on is sent **1.5s after the last tap**, and only
  if it differs from where the taps started (Adeline). Going Auto → Off
  through Manual never switches the aircon on in between.
- The pending mode lives in the shared hooks, so a card knob and a Quick
  Access knob on screen together show the same LED.
- If the aircon does not support Auto, the Auto LED is skipped in the cycle
  *(decided)*.
- **Every LED is named underneath it** (Adeline, 2026-09-12), silkscreen
  fashion — AUTO / MANUAL / OFF — so the modes can be read without cycling
  through them. The colour knob's single caption, which only ever names the
  lit channel, is not enough for a knob whose lights are a set you pick
  between. The base does this only when asked (`ledLabels`), so the colour
  knob keeps its caption.
- The names are etched exactly like the caption — black and white over the
  knob's own tint, no theme colour — and sized
  `clamp(5px, 5% of size, 9px)`, smaller than the caption because three of
  them sit side by side across the face.
- A named light's slot is as wide as its name, so the lights spread to suit;
  the gap between them drops to `1.2 × LED width` to compensate. **The lights
  do not move**: the block is pushed back down by half of what the names added,
  leaving them where they sit on an unnamed dial.

## Face

- **Target above the LEDs**, large: `clamp(14px, 11% of size, 24px)`
  *(decided)*.
- **Room temperature below the LEDs**, smaller: the caption rule,
  `clamp(10px, 7.5% of size, 14px)`. It drops below the LED names rather than
  running through them (Adeline, 2026-09-12).
- Both etched like the dial's caption (black and white overlays, no theme
  colour), formatted by `formatTemperature` with a `°`. The room temperature
  reads `--` when there is no reading.
- Beyond the LED names above, there is no other label on the knob; the card
  title names it.

## Colour ring

The ring shows two temperatures on one scale:

- **Top half: the target.**
- **Bottom half: the room temperature.** Dark charcoal `#1e2024` when there
  is no reading.
- The scale runs **18°C ice blue → 22°C pale warm white → 26°C orange-red**,
  clamped outside that range (Adeline). Hexes *(decided)*: `#8ad8ff`,
  `#f6efe4`, `#ff4a1c`, interpolated in sRGB between neighbouring stops.
- The two halves **blend into each other over about 30px of arc** at 3 and 9
  o'clock, measured along the ring's mid radius, at every size. The blend's
  angle is therefore `30px / r_mid` radians, wider on a small knob.
- No checkerboard: there is no alpha.

## Glow

The ring glows in the **target colour only while the unit is running**:
the aircon actively heating, cooling or fanning (power not Off and the unit
reporting `heat`, `cool`, `fan_only` or `dry`); the heater's switch on. No
glow when idle or Off (Adeline). The glow uses the lighting knob's full-glow
figures (`t = 1` in its formula).

## Unavailable

An unavailable or unknown entity gets the base's disabled treatment (faded,
no LED lit, no glow, no input). The temperatures still show.

## Tuck-away

On, with the base's 5000ms idle timeout. The knob starts locked. Locked, it
still shows the colour ring, both temperatures and the mode LEDs; the rings
are hidden. See "Tuck-away" in `specs/color-encoder.md` for the gesture,
timing and motion.

## Rings

### Aircon, innermost to outermost (Adeline): Mode, Fan, Fresh Air, Timer

1. **Mode** — a symmetric `selector`, stops **Cool, Fan, Heat** spaced evenly
   over the full 270° arc: Cool at the 7:30 end, **Fan at 12 o'clock**, Heat
   at the 4:30 end. **No value text**, so the arc keeps its full length and
   Fan stays at 12. The ring does not fill behind the thumb; **the whole
   track takes the selected mode's colour**:
   - Cool — ice blue `#8ad8ff`
   - Fan — charcoal grey `#3a3d44`
   - Heat — orange-red `#ff4a1c`

   **In Off the thumb sits on the remembered mode and the track is an empty
   well** (Adeline). In Auto it shows the direction the controller is
   running. A stop the unit does not support cannot be chosen; the thumb
   snaps to the nearest supported stop *(decided)*.
2. **Fan** — a stepped `slider` over `AIRCON_FAN_STEPS`, filled behind the
   thumb. Value text: `QUIET`, `LOW`, `MED LOW`, `MEDIUM`, `MED HIGH`,
   `HIGH`, `TURBO`. The ring's length fits the widest of them.
3. **Fresh Air** — a `toggle` labelled `Fresh Air`, no value text (Adeline).
   Tapping it flips `freshAirSwitch`; the fill fades in or out over 500ms.
   Omitted when the home has no fresh-air switch *(decided)*.
4. **Timer** — see below.

### Heater: Timer only

### Timer (both devices)

- A `slider` from **0 to 240 minutes in 2-minute steps**.
- Value text: whole minutes left, rounded up, as **`38 MIN`**; **`OFF`** at 0.
  The ring's length fits `240 MIN`.
- **Setting it to the bottom clears the timer** (`offTimerEndsAt: null`).
- Set to 2 or more, it stores `offTimerEndsAt = now + minutes` through the
  existing saves (`/api/aircon/timer`, `saveBedroomHeater`).
- **The thumb creeps down live**: the ring's value is recomputed from
  `offTimerEndsAt` every second. While a drag is held the drag owns the value.
- At zero the server's existing expiry (`stopAndCancel` in
  `lib/climate-control.ts`) switches the unit off and sets Off mode. The
  aircon's client-side expiry (a `turn_off` with `autoMode: false`) stays as
  a backup, moved from the card into `useAirconCommands` so there is still one
  instance *(decided)*.

## Mode and ring rules

- **Auto:** picking a mode or a fan speed by hand **drops to Manual**, as it
  does today (Adeline; `setMode` and the fan-step commands already carry
  `autoMode: false`).
- **Off** (Adeline):
  - The knob **saves the target only**. The aircon gets a preference-only
    save with no Home Assistant command, `POST /api/aircon/target`, modelled
    on `/api/aircon/timer`. The heater's `changeTarget` already only saves.
  - Picking a mode or a fan speed **starts the aircon in Manual** with that
    choice.
  - **Fresh Air only toggles the switch.** The aircon stays off.
  - Setting a timer **starts the unit** — the aircon in Manual, the heater in
    Auto — and then sets the timer.
- Fan-step, fresh-air and timer commands live in `useAirconCommands` /
  `useBedroomHeaterCommands`, not in a card, so every surface shares one
  implementation.

## Where it is used

- **Full cards** — `AirConditionerControl` and `BedroomHeaterControl` in
  `ClimateControls.tsx`: `ControlCard` plus one 200px knob, nothing else. The
  stepper, the power and mode buttons, the timer row, the fan slider, the
  Fresh Air switch and the heater's humidity line are gone (Adeline). The
  `ModuleSlot` extension points stay *(decided)*. The legacy
  `PanelHeaterControl` is unchanged.
- **Quick Access** — the title plus a 100px knob. See
  `specs/quick-access-card.md`.

## Done means

- Every item above is observable on the demo page and the live dashboard.
- Unit tests cover the colour scale, the split paint and blend width, timer
  text and minutes maths, fan text, the 0.5°C step, the size clamp, the mode
  debounce, the Off rules and the timer semantics.
- e2e on the demo page covers lock and unlock, ring order, the blocker, the
  portal after scrolling, the timer creeping down and the mode debounce.
- `npx tsc --noEmit`, `npm run test:unit`, `npm run test:aircon`,
  `npm run test:e2e` and `next build` are clean.
- An adversarial visual review passes: screenshots at 100, 150 and 200px, in
  dark and light, locked, unlocked and mid-animation, every mode, the timer off
  and running, no room reading, the aircon's four rings and the heater's one,
  the full cards in portrait and landscape, and Quick Access at 100px —
  reviewed against this spec until a reviewer finds no deviation.
