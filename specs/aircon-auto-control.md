# Lounge aircon — Auto control

Owner: Adeline. Written 2026-09-05 after the unit sat off for six minutes with
the room two degrees below the target she had just set. Produced by plan
`calm-sprouting-sun`.

This spec covers the lounge Gree's Auto thermostat: when it starts, when it
stops, which guards apply, and — the part that was missing — how a change the
owner makes differs from a change the sensor implies. It supersedes the
reversal rule previously stated in `docs/aircon-auto.md`; everything else in
that document remains a correct summary and now points here.

## Implementation

This is the dashboard's own thermostat, not Home Assistant's or the Gree
unit's native Auto mode. The planner is React-free, lives in
`lib/aircon-control.ts`, and runs on a 1000 ms poll interval. The dashboard
tick skips while the tab is hidden or another climate action is in flight, and
decides from the shared SSE/poll snapshot rather than fetching per tick.
Planned actions apply through `/api/entity`. Each acting tick emits
`aircon-auto`; each change of blocking reason emits `aircon-auto-held` once —
both carry the planner's `reason` and `wantedMode`. The loop runs only while
`preferences.aircon.autoMode` is true.

The control sensor is the Gree unit's own `current_temperature`, downstream of
the compressor it drives (§2). `sensor.lounge_temperature` reads the same
attribute for display only and must never feed control.

Supported modes are heat, cool, fan-only and auto; Auto only ever commands
heat or cool (Dry, native or emulated, is covered separately — see Dry
emulation, below). Fan steps range from quiet through turbo; while driving,
the planner picks fan strength from the absolute delta.

## 1. The incident this comes from

Reported: "the aircon isn't turning on when changing the temp in auto mode…
this happens when the unit itself is switched off. it beeps to reflect the temp
change but the dashboard isn't turning it on."

Home Assistant history for `climate.c6780cad`, container logs, and
`data/climate-control.json` on iridium, 2026-09-04 (UTC):

```
18:46:20  Auto stops at 24 (target reached); settlingFromTemperature = 24
18:54:29  set_temperature 26 from the dashboard, unit off — the Gree beeps,
          preferences are written, NO start
19:00:41  the unit finally starts, six minutes late, only once the sensor
          drifted to 23 and the trend extrapolation happened to pass
```

A second dead period the same evening — 16:22 to 18:23, room falling 26 → 22 —
was **not** this bug: Off was pressed on the wall panel at 16:22:20, which
clears Auto. That is correct behaviour and is retained (§3.2).

### Root cause

`planAirconAutoTick` treated a user-moved target as a one-tick flag.
`reopened` was derived from `lastTargetTemperature !== targetTemperature`, and
`reopened` was the only thing that bypassed the conservative sensor guards. But
every return path below it — including the *refusals* `min-cycle-hold`,
`mode-hold` and `sensor-settling-hold` — adopted the new target into
`lastTargetTemperature` through `cycleBase`.

So on the first tick after the change the intent existed but the 10-minute
compressor dwell refused the start; five seconds later the change detector had
already caught up, `reopened` was false, and the request was gone. The unit
reverted to waiting for a settled sensor.

**Any guard that deferred a user-initiated start silently destroyed it.**

Compounding it, `lastTargetTemperature` lived only in process memory — it was
absent from `airconAutoCycleStateFromPreferences` — so a container restart also
erased pending intent.

## 2. The distinction the whole design rests on

Every guard in this thermostat exists to stop the **sensor** from driving the
compressor. The sensor is the Gree's own return-air thermistor, sitting
downstream of the compressor it is controlling; on 2026-08-09 it produced seven
starts and four heat↔cool reversals in 45 minutes because it heat-soaked 22 → 23
in one second after a stop. Every threshold in `lib/aircon-control.ts` is sized
against that transient.

None of it was ever meant to apply to a person.

| | sensor-driven transition | user-driven transition |
|---|---|---|
| 10-minute compressor off-dwell (`AIRCON_AUTO_MIN_CYCLE_MS`) | applies | **bypassed** |
| 30-minute settling wait (`AIRCON_SENSOR_SETTLE_MS`) and its trend extrapolation | applies | **bypassed** |
| 3 °C reversal threshold (`AIRCON_AUTO_DIRECTION_CHANGE_DEGREES`) | applies | **bypassed** |
| 30-minute direction hold (`AIRCON_AUTO_MODE_HOLD_MS`) | applies | **bypassed** |
| 1 °C same-direction resume (`AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES`) | applies | any non-zero error acts |
| stop at target | immediate | immediate |

A **user-driven transition** is exactly two things: a target the owner moved,
and a fresh press of Auto (`forceRemember`). Nothing else — a sensor reading, a
poll, a restart, a module — may claim this status.

## 3. Decisions

Interview, 2026-09-05.

### 3.1 A user-initiated change starts the unit immediately

No compressor off-dwell, no settling wait. The next 5-second tick after the
target change must issue the start.

*Why:* the guard exists to stop the sensor short-cycling the compressor, and
the Gree enforces its own restart delay in firmware regardless. A person who
raises the target and watches nothing happen has no way to tell a working
system from a broken one — and reported this as broken.

Autonomous cycling keeps every guard it has today, unchanged.

### 3.2 Off means off

Pressing Off sets `autoMode: false`. Auto must be re-armed by hand. On/Off/Auto
remains a true tri-state, and the card keeps an honest "nothing is managing
this" state.

*Why:* Adeline, 2026-09-05, on the 16:22–18:23 gap: keep it. Off is a
deliberate "stop managing this", not a pause.

### 3.3 A target moved across the room temperature goes straight into the other mode

If the unit is running heat and the owner drops the target below the reading,
Nova issues a single `set_hvac_mode: cool`. No intervening `turn_off`, no
30-minute direction hold, no 3 °C threshold.

*Why:* Adeline, 2026-09-05 — "if I do this then it was intentional, go straight
into the other mode."

This reverses the previous rule ("no guard may permit a direct heat-to-cool
reversal") and re-enables the deliberately dead `changedTargetMode` branch. It
is safe because the reversal that caused the 2026-08-09 incident was
*sensor*-driven, and autonomous reversals still carry the full 3 °C threshold
and 30-minute hold. The Gree's firmware compressor protection is unaffected by
what Nova sends.

<!-- SPEC.md §15 said breaking the 30-minute direction hold is decided in the
UI, not the planner (pressing Heat/Cool, or moving the setpoint more than 1
degree past the current reading), see docs/aircon-auto.md. This file's
mechanism instead has the planner itself perform the reversal, driven by the
userRequestAt latch (§4), with no stated 1-degree threshold. Kept this file's
version, which is newer. Verify. -->

### 3.4 The card gains no new text

The queued intent is reported in `/api/state` as
`climateControl.<room>.pendingUserRequestAt` for diagnostics only. Phase
continues to report `resting`. No countdown, no status line, no popup.

*Why:* the climate card's standing rule — short labels, no popups, no reflow.

## 4. The latch

The mechanism that makes §3.1–3.3 work.

**Name:** `userRequestAt: number | null` on `AirconAutoState`. It is the
timestamp of the last user-initiated change that has not yet been acted on.
`null` means there is no outstanding request.

**Set by**, in `planAirconAutoTick`:

- `targetChanged` — `lastTargetTemperature` is non-null and differs from the
  effective target. A null `lastTargetTemperature` is a *fresh planner*, not a
  change, and must not set the latch.
- `forceRemember` — a fresh press of Auto. This can update stored auto
  preferences without immediately requiring an HA mode change.

Otherwise the latch is inherited from the incoming state. It is **not** cleared
by observing the new target: `lastTargetTemperature` is a change detector and
nothing more.

**Cleared by**, and only by:

1. Emitting actions that start or redirect the unit — the request has been
   served.
2. Resting because the target is genuinely satisfied: `reached-target`, or
   `resting` where the error is zero.
3. `unsupported-direction` — the unit cannot do what was asked, so waiting
   changes nothing.
4. `sensor-fail-safe-off` — Auto is being cleared entirely.
5. Expiry: `AIRCON_USER_REQUEST_MAX_AGE_MS` = 30 minutes. A request that could
   not be served in half an hour (the entity was unavailable, or ownership was
   external) must not fire later against a room that has since moved on.

**Persistence.** The latch and the change detector both survive a container
restart, carried in preferences as `autoUserRequestAt` and
`autoLastTargetTemperature` alongside the existing `autoLastMode` /
`autoLastTransitionAt` / `autoRecentStartsAt` family (the last backing the
compressor-start rate limit, §6), and folded back by
`airconAutoCycleStateFromPreferences`. `AirconAutoThermostat.reconcile` merges
the latch with the same "whichever is further ahead wins" rule as the other
clocks, so a latch set by another client is not dropped by this process's stale
memory. `resetForUserRequest` preserves it.

**While latched**, the planner:

- treats any non-zero error as needing to drive (`absDelta > 0`);
- skips `mode-hold`, `sensor-settling-hold` and `min-cycle-hold`;
- skips the equivalent `holdBlocked` test in the sensor-grace branch, so a
  blind attempt is not deferred either;
- reverses directly while running, per §3.3.

## 5. Manual mode

`planManualAirconTick` has the same shape and the same defect: with the unit
off it returns `hold` until the 10-minute off-dwell and the settling trend both
agree, and it has no concept of a user-initiated target change at all. A target
moved in Manual starts the unit on the same terms as Auto — §3.1 applies
identically. Manual has no direction to reverse, so §3.3 does not arise.

## 6. Deliberately unchanged

- **Stops are never delayed.** No guard in this file may be the reason the unit
  keeps running. Heat stops at or above target, cool at or below, immediately,
  on the raw reading.
- **The sensor fail-safe.** Auto may run blind for `AIRCON_AUTO_SENSOR_GRACE_MS`
  (2 minutes); after that the unit switches off and Auto is cleared, requiring a
  later user action. It does not retry forever.
- **The median filter.** Starts and direction selection use the median of the
  five most recent fresh readings; stopping uses the raw value.
- **Autonomous guard values.** 10-minute dwell, 30-minute settling, 10-minute
  sensor time constant, 3 °C reversal, 1 °C same-direction resume, a cap of 3
  compressor starts in any trailing hour, and the first-order extrapolation
  that may resume a same-direction cycle early.
- **Ownership.** Someone working the unit itself still takes ownership away
  from Nova; a target change does not reclaim it. Only mode intents do.
- **Off clears Auto** (§3.2).

## 7. Done

1. `npm run test:aircon`, `npm run test:unit` and `npm run build` pass.
2. Planner tests cover: a start inside the dwell after a user change; the latch
   surviving a tick that did not act; a direct reversal emitting one
   `set_hvac_mode` and no `turn_off`; the latch clearing once driving and the
   next autonomous cycle observing the full guards again; the latch surviving a
   preferences round-trip; the latch expiring at 30 minutes; and the unchanged
   autonomous behaviour of §6.
3. Live on the lounge unit: with the room below target and Auto resting inside
   the 10-minute dwell, raising the target puts `climate.c6780cad` into `heat`
   within roughly ten seconds, visible in HA history. Dropping the target below
   the reading while heating produces a single transition to `cool` with no
   intervening `off`. A subsequent untouched cycle still spaces its starts by at
   least ten minutes.

## Dry emulation (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2.

- A climate device **without** a native `dry` mode is offered Dry only when its
  room has both a humidity sensor and a temperature sensor.
- Nova runs it like emulated Auto, toward `dryTargetHumidityPct` (default 55).
  Above target + 3 % it runs `cool` at the lowest fan speed with a setpoint 1 °C
  below room temperature, never below the device minimum. At or below target it
  switches to `fan_only`, or off if that is unsupported. It uses the same minimum
  dwell and rate limit as Auto. Stale sensors (older than the Auto grace window)
  hold it in its current state.
- A device with native Dry simply gets `dry`.
