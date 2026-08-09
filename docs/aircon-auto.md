# Dashboard Air-Con Auto

Nova dashboard Auto is a dashboard-managed thermostat loop, not the Gree or Home Assistant HVAC `auto` mode.

## The measurement is the problem

Auto measures `climate.c6780cad`'s own `current_temperature` — the Gree indoor unit's return-air thermistor. That sensor sits **downstream of the compressor Auto is controlling**, so it responds to the actuator as much as to the room. It moves 2–3 °C on every compressor transition, sometimes within a single second, and heat-soaks upward whenever the fan stops.

`sensor.lounge_temperature` reads the *same* attribute. It is fine for display and must never be wired into control: doing so recreates the loop while looking like a fix.

Everything below exists because of this. A standalone lounge room sensor is the real fix; until then Auto can only be bounded, not made correct.

## Rule That Must Not Change

The planner uses this signed delta:

```text
delta = measuredRoomTemperature - selectedTargetTemperature
```

If `delta > 0`, the room is hotter than the target and the wanted direction is `cool`.
If `delta < 0`, the room is colder than the target and the wanted direction is `heat`.

"Wanted" is not "commanded" — see the guards. This rule is covered by `npm run test:aircon`.

## Ownership

`lib/aircon-control.ts` owns:

- climate temperature parsing
- dashboard Auto state and all four guards
- heat/cool choice
- fan step mapping
- quiet and turbo switch actions
- Home Assistant action payloads

`app/components/dashboard/useAirconAutoMode.ts` runs the loop (client-side, 1 s, bails on `document.hidden`) and reconciles the durable guard state. `app/components/dashboard/ClimateControls.tsx` renders the controls and is the only place that may decide a gesture was a person expressing intent.

## Idle Behavior

When the reading reaches target, Auto switches the unit **off** (homeostasis = off). It used to park on `fan_only`; that is gone. The dashboard still reads "Auto" while the unit rests, because the remembered `autoMode` preference — not the unit's power — drives the power display.

The hysteresis is asymmetric on purpose:

- **off AT target** — the moment the reading reaches it, in whichever direction is running
- **resume `AIRCON_AUTO_RESUME_DEGREES` (3 °C) past target** — not before

A symmetric ±1 °C band was the direct cause of the 2026-08-09 incident: the unit reached target 22, switched off, the thermistor heat-soaked to 23 in one second, and the planner read that single degree as "the room is too warm, cool it" — in the middle of winter. Seven compressor starts and four heat↔cool reversals in 45 minutes followed.

## The guards

Three rate limits sit on the mode decision:

| Guard | Size | What it stops |
|---|---|---|
| `AIRCON_AUTO_MODE_HOLD_MS` | 30 min | Reversing heat↔cool. Caps direction changes at two an hour, and gives the thermistor time to settle. |
| `AIRCON_AUTO_MIN_CYCLE_MS` | 10 min | Restarting the compressor. Same size as `BEDROOM_HEATER_MIN_CYCLE_MS`. |
| `AIRCON_AUTO_MAX_STARTS_PER_HOUR` | 3 | Compressor starts in any trailing hour. |

**None of them can delay turning the unit OFF.** Stopping is always safe and always cheap; a guard that held a `turn_off` would leave the unit driving the room the wrong way for up to ten minutes. Only starting is rate-limited.

While the unit is already driving, no reversal is even reachable: "not yet at target" and "wanted the other way" are contradictory, so the running direction is the wanted direction until target is reached.

### The guards live in preferences

The thermostat's state is held in a per-tab `useRef`. A 30-minute hold that resets whenever the kiosk reloads — which it does on every deploy — would not be a hold, and two open dashboards would each keep their own idea of when the compressor last started.

So `lastMode`, `lastModeAt`, `lastTransitionAt` and `recentStartsAt` are mirrored into `preferences.aircon` (`autoLastMode`, `autoLastModeAt`, `autoLastTransitionAt`, `autoRecentStartsAt`) by `airconAutoCycleRemember`, riding on the `remember` payloads the loop **already** sends with every transition — so this costs no extra preference write and no extra history revision. `AirconAutoThermostat.reconcile()` folds the durable copy back in before each tick, keeping whichever copy is further ahead.

## What a person can override

The planner cannot tell a user setpoint change from Home Assistant echoing one back: both arrive as identical `POST /api/entity` calls, and the target is read off the entity. So intent is decided in `ClimateControls.tsx`, where the gesture is unambiguous, and written to preferences.

| Rule | Interaction | Effect |
|---|---|---|
| R1 | **Heat** or **Cool** pressed | Leaves Auto, and seats `autoLastMode`/`autoLastModeAt`, so returning to Auto later holds the direction the user last asked for. |
| R2 | A **user-moved setpoint landing more than `AIRCON_INTENT_MARGIN_DEGREES` (1 °C) the far side of the reading** | Clears `autoLastModeAt`, so the next tick may reverse. See `airconUserModeIntent`. |
| R3 | **Off → Auto** | Re-seats the direction from the current delta; the dwell and hourly start count are carried over, because pressing a button twice must not short-cycle a compressor. |
| R4 | Anything else | Never breaks the hold — not a drifting reading, not a band crossing, not an HA echo, not a page reload. |

R2 is the distinction that matters: nudging the target a degree while the room sits near it is a comfort tweak and says nothing about direction. Dropping the target well below the room is unambiguously "cool the room". Only the second one counts, and because it is evaluated in the tap handler, a reading that merely drifted can never satisfy it.

A target the user moved also **reopens a resting cycle** even inside the 3 °C resume band (`reopened` in the planner). Without that, asking for two degrees warmer would do nothing until the room drifted three degrees, which reads as a dead control.

## Diagnosing it

Every autonomous tick emits `event: "aircon-auto"` with `reason` and `wantedMode` alongside the sensor/target/delta. Blocked ticks emit `event: "aircon-auto-held"` once per change of reason — the loop ticks every second, so anything per-tick would flood the spool. `wantedMode` is what makes a reversal visible; without it, the 2026-08-09 flip-flop had to be reconstructed from Home Assistant's own history instead.

## Changing This Code

Before changing Auto behavior:

1. Update or add a case in `lib/aircon-control.test.ts`. Pass `now` explicitly — there are no fake timers, and the guards are 10 and 30 minutes long.
2. Run `npm run test:aircon`.
3. Run `npm run build`.
4. Check that heat/cool actions include both `set_hvac_mode` and a `set_temperature` payload with the same `hvac_mode` when the mode changes, and that no `turn_on` precedes a `set_hvac_mode` (`set_hvac_mode` powers the unit on by itself; a `turn_on` in front of it lands the unit in its *previous* mode for a moment).
