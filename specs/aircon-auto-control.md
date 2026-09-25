<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
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
| minimum move to register a direction (`airconUserModeIntent`) | n/a — the sensor path reads error, not intent | **none**; any target across the reading counts (§3.3) |
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
30-minute direction hold, no 3 °C threshold, and **no minimum move** — any
target on the other side of the reading counts, by however little.

*Why:* Adeline, 2026-09-05 — "if I do this then it was intentional, go straight
into the other mode."

This reverses the previous rule ("no guard may permit a direct heat-to-cool
reversal") and re-enables the deliberately dead `changedTargetMode` branch. It
is safe because the reversal that caused the 2026-08-09 incident was
*sensor*-driven, and autonomous reversals still carry the full 3 °C threshold
and 30-minute hold. The Gree's firmware compressor protection is unaffected by
what Nova sends.

`airconUserModeIntent` carried a one-degree margin until 2026-09-16, meant to
tell a comfort nudge from a reversal request. It could not: the setpoint does
not carry that distinction, and guessing wrong left the unit heating a room the
owner had just said was too hot.

*Why it went:* Adeline, 2026-09-16 — "if it's too hot it needs to cool
immediately, and vice versa. if the user makes a mistake they can fix it." An
unwanted flip costs one press to undo; an ignored request is a room that stays
wrong and a control that looks broken.

What keeps Auto from oscillating is not a margin here but the `reopened` gate:
this branch is reachable only for a target the owner moved or a fresh press of
Auto, never for sensor drift. The sensor-driven path keeps the full 3 °C error
and 30-minute hold (§3.1), and a target exactly equal to the reading still asks
for no direction at all.

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
4. Expiry: `AIRCON_USER_REQUEST_MAX_AGE_MS` = 30 minutes. A request that could
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
- reverses directly while running, per §3.3.

A latch is **not** consumed by a tick with no usable reading (§5.2): the request
survives the outage and is served as soon as a reading returns, within its
30-minute expiry.

## 5. Manual mode

Manual is a thermostat, not a hand on the switch. `planManualAirconTick` runs
the direction the owner chose: it starts the unit to reach the target and
switches it off again on arrival, then picks it up when the room drifts past the
1 °C resume band — the same guards as Auto, minus the direction choice.

`planManualAirconTick` had the same defect Auto did: with the unit off it
returned `hold` until the 10-minute off-dwell and the settling trend both agreed,
and it had no concept of a user-initiated target change at all. A target moved in
Manual now starts the unit on the same terms as Auto — §3.1 applies identically.
Manual has no direction to reverse, so §3.3 does not arise.

### 5.1 The mode switch is the owner's (Adeline, 2026-09-19)

> "the auto/manual/mode toggle is a switch that the user sets, nobody else. if
> it's set to manual then it has to stay on and continue running the manual
> rules, which are to turn the air conditioner unit on as needed to heat or cool
> as the user has dictated."

Because Manual rests the unit at target, **the selected mode can never be
inferred from the unit's power.** It used to be: `mode` came out as Manual only
while the Gree reported itself on, or while a `manualDirection` happened to be
remembered. So the first tick after Manual reached the target published
`mode: "off"` and the card deselected itself — and on a room already at
temperature, that was the tick right after she pressed Manual.

The rules, all of them server-side (`lib/climate-control/`):

- **The mode is stored, not derived.** `PersistedRoom.mode` holds Auto / Manual /
  Off, durable across restarts and deploys. `airconControlMode`
  (`mode-model.ts`) returns it; the old power-based inference survives only as
  the fallback for a state file written before the field existed.
- **A thermostat resting the compressor is not a mode change.** Manual's own stop
  at target sets `restingNow`, which publishes `phase: "resting"` with the mode
  untouched. `forcedOff` — the flag that publishes `mode: "off"` immediately — is
  for `stopAndCancel` only, which genuinely does end the mode.
- **Which actions change it** (`airconLegacyActionIntent`,
  `action-intent-model.ts`): `remember.aircon.autoMode` is the explicit
  statement and wins, because Auto arms itself with a `set_hvac_mode` that would
  otherwise read as Manual and rests with a `turn_off` that would otherwise read
  as Off. Failing that, a `set_hvac_mode` **aimed at the unit** selects Manual
  (or Off for `hvac_mode: "off"`), a `turn_on` aimed at it selects Manual unless
  Auto is already stored, and a `turn_off` **aimed at the unit** is Off. A
  `turn_off` aimed at anything else — the quiet, fresh-air or xtra-fan switches —
  ends nothing, even when its `remember` carries `autoMode: false`: that field
  means "leave Auto for Manual" there, and reading it as Off unset the mode on an
  ordinary fan-step press, because a press's `remember` rides whichever action
  happened to be last (`airconFanStepActions`).
- **Any direction command seats the direction.** A bare `set_hvac_mode` from
  voice, an automation or MCP carries no `remember`; it used to leave Manual with
  no direction and so nothing to restart on.
- **Off stays Off.** A stored Off outranks a unit Home Assistant still reports as
  running — that is a `turn_off` the Gree has not acknowledged yet, not a mode.
  Someone working the unit itself takes ownership away from Nova instead, which
  the public state reports separately.
- **The card follows.** `useAirconCommands` keeps the Heat/Cool light on the
  controller's `direction` while the room rests, instead of blanking the mode row
  every time the compressor stops.

Only an expired sleep timer ends the mode without the owner, through
`stopAndCancel`, and it is the owner's own instruction — she armed the timer. The
sensor fail-safe does not end anything: it switches the unit off and leaves the
mode selected, waiting for a reading (§5.2). Both are explainable afterwards.

**Nothing else may end it, and that is now structural.** Adeline, 2026-09-24:
"user selected mode should never be unset by any process, ever." An action only
speaks about the mode when it is aimed at the unit's own device — the aircon's
climate entity — or says so explicitly in its `remember` (`speaksForTheUnit` in
`action-intent-model.ts`, computed in `climate-control/intents.ts`). The service
that made that necessary is the aircon's own companion controls:
`handleLegacyClimateAction` resolves any entity whose id or name matches
`/air|quiet|turbo|xtra/` to the same instance, so a `turn_off` aimed at
`switch.c6780cad_quiet_mode` was read as the owner choosing Off.
`useAirconCommands.setOn` sent exactly that on every press of Manual — its
quiet-mode housekeeping — so the Manual she had just selected went out on its own
a moment later, leaving the unit running with no mode selected at all and
therefore nothing managing it. A companion control can still carry an explicit
`autoMode` in its `remember` (that is how choosing a fan speed by hand leaves
Auto), and a `turn_off` aimed at the unit itself — the card's Off light, voice, an
automation, MCP — still means Off.

### 5.2 No blind running, and no fail-safe that cancels the mode

> "we don't run heating or cooling blind. but we do leave the goddamn mode
> selected in case a temp value comes back." — Adeline, 2026-09-19

A usable reading is one that passes `autonomousClimateInputIsUsable`: a real
number, from an entity that is not `unavailable`, reported within
`AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS` (30 minutes). With no such reading there is
no direction to choose and nothing to stop at, so:

- **The unit switches off.** Immediately, on the tick the reading goes — not after
  a grace window, and never on a guessed direction. `driveAircon` also drops the
  median buffer when the raw reading is null, so the filtered value cannot keep a
  start alive on half-hour-old data. Manual stops through the same rule
  (`planManualAirconTick` returns `stop` while running with no raw reading).
- **The mode stays selected.** The stop rides out on `offAutoActions`, which
  carries `autoMode: true`; Manual's stored mode is untouched. The public state
  reads `phase: "grace"` — waiting — with `lastStopReason: "sensor-unavailable"`,
  and Nova's unasked-for stop is recorded through `emitClimateControllerWrite`
  (`specs/bedroom-heater-control-integrity.md` §5).
- **It waits, it does not retry.** No action at all while the reading is missing,
  however long that lasts, so the loop can sit there indefinitely without
  touching the unit.
- **A returning reading resumes at once**, subject to the compressor dwell and
  the direction hold — but *not* the 30-minute settling hold, which exists for the
  enclosed thermistor's post-stop transient and has nothing to extrapolate across
  an outage (`sensorJustReturned` in `plan-model.ts`).

**The one exception: a start the owner just asked for.** The Gree's thermistor
only reports while the unit runs, so a unit that has been off for half an hour has
no reading at all — and refusing to start without one would make Manual and Auto
dead controls exactly when she reaches for a cold unit. A press (any mode intent;
`claimClimateControl` latches it, as a moved target already did) may therefore run
the unit for `AIRCON_BLIND_USER_START_MS` — two minutes — without a reading. It
attempts only the direction she chose or the one already running, never a guess
between heat and cool; if no reading has arrived when the window closes the unit
stops and waits, mode intact. The distinction is the whole point: **the loop never
runs blind on its own, and a person asking is not the loop.** The bedroom heater
has no such exception — its sensor is a separate puck that reports whether or not
the element is on.

What this replaces: `AIRCON_AUTO_SENSOR_GRACE_MS` / `BEDROOM_HEATER_SENSOR_GRACE_MS`
(2 minutes of blind running, then `sensor-fail-safe-off`, with the controller
clearing Auto through `stopAndCancel`). Both constants and that reason are gone;
so is the `sensorGraceEndsAt` field, since the wait has no deadline. The earlier
rationale — that the Gree only reports a temperature while running, so Auto had to
run blind to self-start — is not worth cancelling her mode for: the unit reports a
fresh `current_temperature` while off in practice, and if it ever stops, the answer
is a room sensor, not a guess.

The same rule applies to the bedroom heater: `planBedroomHeaterTick` switches the
element off and holds with Auto still armed.

### 5.3 The direction Manual runs is the owner's seat (Adeline, 2026-09-24, 2026-09-25)

> "air conditioner set to manual from off. room temp 21. target temp 27. air con
> beeps, does not turn on, eventually switches to off." … "it was already set to
> heat when I first tried it. it's winter, I never set it to cool" … "even if it
> wasn't [the correct direction], it shouldn't lose mode, as it HAD a temperature
> reading from the room."

`climate.c6780cad`, 2026-09-23 (its HA history, and her account of it):

```
17:36:08.568  cool      <- a press of Manual on the card
17:36:08.609  off       <- 41 ms later, the loop at "target reached"
17:43:45      cool/off  the same, again
17:44:42      cool/off  the same, again
17:45:09      heat      pressing Auto first: Auto's own arm, direction heat
17:45:09.251  heat+high Auto's fan step for a six-degree error
17:45:18      (nothing) Manual pressed again — every command a no-op, because
                        Auto had already left the unit heating
```

The unit beeped twice per press and never ran. Two independent causes:

- **The direction came from memory.** `preferences.aircon.hvacMode` said `cool`
  and the card sent it, because the card read the remembered direction as the
  direction the owner had dictated. It is not: **Nova's own Auto leg writes that
  field**, and it wrote `cool` that morning from the Gree's heat-soaked thermistor
  reading above the target while the unit was off (08:16, 09:22 and 10:20 in the
  same history). Manual then ran *cool* at a room six degrees *below* its target —
  a direction that has already arrived, so the manual thermostat's first tick
  stopped the unit. Arming Auto first appeared to fix it only because Auto's arm
  rewrote the remembered direction to heat, from the room it could see.
- **The mode was then unset anyway**, by the press's own quiet-switch housekeeping
  (§5.1), leaving the unit running with nothing managing it.

**The rules:**

- **One place decides the direction.** `manualAirconDirection`
  (`climate-control/manual-direction-model.ts`): the direction the owner seated is
  the answer; with nothing seated, a room below its target runs heat, above it runs
  cool, and a room exactly on the target has nothing to choose, so the unit runs on
  in whatever direction it is already running — which is what still lets a running
  unit stop.
- **A target never changes the mode.** A seated heat or cool holds whatever the
  room does; the room only answers when nothing is seated. Adeline, 2026-09-25:

  > "if the mode is set to heat and I set a temp below the room temp … check that
  > it doesn't change the mode on me. if the mode is wrong for the desired outcome
  > already then that's user error and not for the app to fix."

  The direction is the mode that maintains the temperature once the room arrives
  on its own — heat holds a floor and never cools a room to reach a target the
  weather will reach anyway — so it is hers to set and only she moves it. The room
  used to overrule a seat once it sat more than
  `MANUAL_AIRCON_DIRECTION_FLIP_MARGIN_C` (1 °C) past the target, which made every
  target change a mode change: on 2026-09-25 heat was seated with the target moved
  to 21 in a 25 °C room, Nova ran `climate.c6780cad` in cool and the Heat light
  went with it, and pressing Heat again was undone by the loop within one tick —
  repeatedly, until the unit was switched off by hand. That constant and its rule
  are gone. **Auto is unchanged and is not covered by this:** the direction there
  is the thermostat's to choose (§3.3), not the owner's to hold.
- **The press and the loop answer it the same way.** `useAirconCommands.setOn`
  sends the seated direction, and derives one from the room only when nothing is
  seated — a press must not overrule a seat either. Where nothing can be derived —
  no seat, no reading, and no usable remembered direction — it sends a bare
  `turn_on` rather than guessing: the old fallback was the unit's first supported
  mode, which for this Gree is `auto`, a mode Manual cannot run, leaving Manual
  with no direction and nothing to start.
- **A stop in a direction the room contradicts does not serve the request.** The
  request latch (`manualUserRequestAt`) survives it, so the next tick starts the
  direction the room needs instead of waiting out a compressor dwell for a request
  it had already thrown away. `lastStopReason` reports `wrong-direction` rather
  than claiming the target was reached.
- **A remembered direction is not a fallback for it either.** With nothing seated
  and no usable reading there is no direction to run, so `driveAircon` drives
  nothing until one of the two exists — §5.2's "never a guess between heat and
  cool". Passing `prefs.hvacMode` in as a last-resort direction was tried on
  2026-09-24 and reverted the same day: it chose a direction with no reading to
  check it against. The press is what seats a direction, and a press with a seated
  direction is what runs blind (§5.2).
- **Auto's own guard sizes are untouched** (§6). Every one of them bounds the
  sensor; none of them may make a selected mode inert, and with the direction
  coming from the seat when there is one and the room when there is not, an off
  unit away from its target never lacks one.

### 5.4 A stop is judged by the direction the unit is running

`planManualAirconTick` takes both: `direction` is what an off unit starts on,
`runningDirection` is what it is doing now, and **a stop is the running direction
arriving at its target.** Heating a room past its target stops rather than flipping
to cooling, and a unit running the direction the room contradicts has not arrived
at anything the owner asked for — which is why that stop keeps the request alive
(§5.3).

## 6. Deliberately unchanged

- **Stops are never delayed.** No guard in this file may be the reason the unit
  keeps running. Heat stops at or above target, cool at or below, immediately,
  on the raw reading.
- **Stops are not rate-limited.** No guard may delay switching the unit off,
  including the stop for a missing sensor (§5.2).
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
3. Manual tests (`lib/climate-control-manual.test.ts`,
   `lib/climate-control-mode-model.test.ts`) cover: a stop at target that stays
   in Manual with phase `resting`; a room already at target resting without
   deselecting Manual; the restart once the room drifts past the dwell; Manual
   surviving a controller restart with the unit resting; Off staying off; the
   sleep timer still ending the mode; Auto still resting as Auto.
4. The mode switch and the direction are covered as rules of their own
   (`lib/climate-control-manual-direction.test.ts`,
   `lib/climate-control-mode-model.test.ts`, `lib/climate-control-policy.test.ts`):
   the owner's seat is kept whatever the room is doing, including a target below
   the room; with no seat, or no reading, the room or the running direction
   answers; dry and
   fan-only are never a direction; a companion switch's `turn_off` says nothing
   about the mode while the unit's own `turn_off` still means Off; a companion
   action neither reclaims ownership nor latches a Manual request; and a fan step
   by hand whose `remember` rides a companion switch leaves Auto for **Manual**,
   never Off (`lib/climate-control-manual.test.ts` presses it the way the knob
   does).
5. The 2026-09-24 incident end to end (`lib/climate-control-manual.test.ts`): a
   card press that names the room's direction at a 21 °C room with a 27 °C target
   leaves Manual selected and produces `set_hvac_mode: heat` with no `turn_off`; a
   seated heat with the target moved below the room produces no `set_hvac_mode:
   cool` at all; the press's own quiet-switch housekeeping does not unset the mode;
   and with the unit off and the room away from its target on either side, the loop
   always drives it — heat below, cool above.
6. Live on the lounge unit: with the room below target and Auto resting inside
   the 10-minute dwell, raising the target puts `climate.c6780cad` into `heat`
   within roughly ten seconds, visible in HA history. In Auto, dropping the target
   below the reading while heating produces a single transition to `cool` with no
   intervening `off`. A subsequent untouched cycle still spaces its starts by at
   least ten minutes. Pressing Manual from Off in a room below its target heats
   it on the first tick after the press, with the mode still Manual a minute
   later and no `turn_off` aimed at the unit itself in between. The press may
   still command the quiet switch — that is the fan setting it is choosing — but
   it commands it only when the switch is already the wrong way
   (`useAirconCommands.setOn`), never as housekeeping.

## Dry emulation (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2.

- A climate device **without** a native `dry` mode is offered Dry only when its
  room has both a humidity sensor and a temperature sensor.
- Nova runs it like emulated Auto, toward `dryTargetHumidityPct` (default 55).
  Above target + 3 % it runs `cool` at the lowest fan speed with a setpoint 1 °C
  below room temperature, never below the device minimum. At or below target it
  switches to `fan_only`, or off if that is unsupported. It uses the same minimum
  dwell and rate limit as Auto. Stale sensors (older than
  `AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS`) hold it in its current state.
- A device with native Dry simply gets `dry`.
