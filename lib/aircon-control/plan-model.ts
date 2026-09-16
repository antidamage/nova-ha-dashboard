import { settlingTrendSupportsSameDirectionRestart } from "../climate-control-policy";
import {
  AIRCON_AUTO_DIRECTION_CHANGE_DEGREES,
  AIRCON_AUTO_MIN_CYCLE_MS,
  AIRCON_AUTO_MODE_HOLD_MS,
  AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES,
  AIRCON_AUTO_SENSOR_GRACE_MS,
  AIRCON_SENSOR_RESOLUTION_DEGREES,
  AIRCON_SENSOR_SETTLE_MS,
  AIRCON_SENSOR_TIME_CONSTANT_MS,
  AIRCON_USER_REQUEST_MAX_AGE_MS,
} from "./constants";
import type { ActiveAirconMode, AirconAutoPlan, AirconAutoPlanInput, AirconAutoReason, AirconAutoState } from "./types";
import { climateTargetTemperature, isClimateEntityOn } from "./entity-model";
import {
  airconFanStepForTemperatureDelta,
  airconSupportsHvacMode,
  airconUserModeIntent,
  desiredModeForDelta,
  drivingMode,
  isAirconMode,
} from "./mode-model";
import { autoPlanState, noAirconActions, normalizeAirconAutoState, startsInWindow } from "./cycle-model";
import { activeAutoActions, offAutoActions } from "./action-model";

export function planAirconAutoTick({
  currentTemperature,
  entity,
  forceRemember = false,
  now = Date.now(),
  preferences,
  quietSwitch,
  state,
  turboSwitch,
}: AirconAutoPlanInput): AirconAutoPlan {
  let currentState = normalizeAirconAutoState(state);

  if (!entity) {
    return noAirconActions(currentState, "no-entity");
  }

  const targetTemperature = climateTargetTemperature(entity) ?? preferences?.temperature;
  if (targetTemperature == null || !Number.isFinite(targetTemperature)) {
    return noAirconActions(currentState, "no-target", { lastTargetTemperature: null });
  }

  const selectedMode = isAirconMode(preferences?.hvacMode) ? preferences?.hvacMode : undefined;

  // A target the user moved, versus one that merely differs from a fresh (null)
  // state. Only the former reopens a resting cycle. Computed before the
  // sensor-null branch below because a fresh command also restarts the sensor
  // grace clock — see reopened's use there.
  const targetChanged =
    currentState.lastTargetTemperature !== null && currentState.lastTargetTemperature !== targetTemperature;

  // The owner's request LATCHES. A tick that merely observes the new target must
  // not consume it, or a guard that defers the start (the compressor dwell, most
  // often) silently cancels it instead — which is exactly what left the unit off
  // for six minutes on 2026-09-04 with the room two degrees under target. The
  // latch is cleared only where it has been served or has become moot; see
  // specs/aircon-auto-control.md §4.
  const inheritedRequestAt =
    currentState.userRequestAt !== null && now - currentState.userRequestAt < AIRCON_USER_REQUEST_MAX_AGE_MS
      ? currentState.userRequestAt
      : null;
  const userRequestAt = targetChanged || forceRemember ? now : inheritedRequestAt;
  // A setpoint change reopens the comfort decision, but it must not erase the
  // compressor dwell, direction hold, or diagnostic start history.
  const reopened = userRequestAt !== null;
  currentState = autoPlanState(currentState, { userRequestAt });
  /** Served, or moot: the request stops being outstanding. */
  const served = { userRequestAt: null } satisfies Partial<AirconAutoState>;
  const recentStartsAt = startsInWindow(currentState.recentStartsAt, now);

  if (currentTemperature === null) {
    // pendingSinceAt tracks when Auto FIRST started running blind. A reopened
    // cycle (user changed the target, or just pressed Auto) gets a fresh grace
    // window rather than inheriting a clock that may already be near expiry.
    const pendingSinceAt = reopened ? now : (currentState.sensorPendingSinceAt ?? now);
    const elapsedMs = now - pendingSinceAt;
    const pendingBase = autoPlanState(currentState, {
      recentStartsAt,
      lastTargetTemperature: targetTemperature,
    });

    if (elapsedMs >= AIRCON_AUTO_SENSOR_GRACE_MS) {
      // Ran blind for the whole grace window and still no usable reading. The
      // planner emits the safe stop; the unified controller clears Auto.
      const cycle = autoPlanState(pendingBase, {
        ...served,
        sensorPendingSinceAt: null,
        lastTransitionAt: now,
        settlingFromTemperature: currentTemperature,
      });
      return {
        actions: offAutoActions({ cycle, entity, selectedMode, targetTemperature }),
        nextState: cycle,
        reason: "sensor-fail-safe-off",
      };
    }

    // Still inside the grace window: try to run rather than sit off waiting for
    // a reading that (per airconAutoMeasuredTemperature) only arrives once the
    // unit is actually running. Without a delta to compute a direction from,
    // drive whichever direction is already running, or failing that the
    // user's selected Heat/Cool — never guess between them.
    const pendingState = autoPlanState(pendingBase, { sensorPendingSinceAt: pendingSinceAt });
    const runningNow = drivingMode(entity);
    const attemptMode: ActiveAirconMode | undefined =
      runningNow ?? (selectedMode === "heat" || selectedMode === "cool" ? selectedMode : undefined);

    if (!attemptMode || !airconSupportsHvacMode(entity, attemptMode) || runningNow) {
      // Nothing safe to try (no direction, or unsupported), or already trying —
      // just let the clock run out.
      return { actions: [], nextState: pendingState, reason: "sensor-pending", wantedMode: attemptMode };
    }

    // Respect the hardware guards even for a blind attempt, so a sensor that
    // flaps between missing and present cannot short-cycle the compressor. An
    // outstanding owner request is not the sensor, so it is not held.
    const holdBlocked =
      !reopened &&
      ((currentState.lastMode &&
        currentState.lastMode !== attemptMode &&
        currentState.lastModeAt !== null &&
        now - currentState.lastModeAt < AIRCON_AUTO_MODE_HOLD_MS) ||
        (currentState.lastTransitionAt !== null && now - currentState.lastTransitionAt < AIRCON_AUTO_MIN_CYCLE_MS));

    if (holdBlocked) {
      return { actions: [], nextState: pendingState, reason: "sensor-pending", wantedMode: attemptMode };
    }

    const modeChanged = currentState.lastMode !== attemptMode;
    const cycle: AirconAutoState = {
      ...pendingState,
      ...served,
      lastMode: attemptMode,
      lastModeAt: modeChanged ? now : (currentState.lastModeAt ?? now),
      lastTransitionAt: now,
      recentStartsAt: [...recentStartsAt, now],
      settlingFromTemperature: null,
    };

    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: attemptMode,
        entity,
        fanStep: "medium",
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      nextState: cycle,
      reason: "sensor-pending",
      wantedMode: attemptMode,
    };
  }

  const delta = currentTemperature - targetTemperature;
  const absDelta = Math.abs(delta);
  const running = drivingMode(entity);
  // A usable reading arrived: whatever blind-attempt clock was running is moot.
  const cycleBase: AirconAutoState = {
    ...currentState,
    recentStartsAt,
    lastTargetTemperature: targetTemperature,
    sensorPendingSinceAt: null,
  };

  // A person can deliberately move the target across the measured room
  // temperature to swap heating and cooling. Do that directly: stopping first
  // would create a brand-new dwell lock and defeat the override on the next
  // tick. The fresh-input gate has already passed above.
  //
  // Adeline, 2026-09-05: "if I do this then it was intentional, go straight into
  // the other mode." This branch was dead for a while — the rule used to be that
  // reversals always stop first — but the reversal that rule was written against
  // was the SENSOR's (2026-08-09), and autonomous reversals still carry the full
  // 3 C threshold and 30-minute hold below.
  //
  // Any target across the reading counts, however small the move: the one-degree
  // margin that used to gate this was removed 2026-09-16. Telling a comfort
  // nudge from a reversal request is not something the setpoint can answer, and
  // guessing wrong left the unit heating a room the owner had just said was too
  // hot. `reopened` is the real guard here — it is only true for a target the
  // owner moved or a fresh press of Auto, never for sensor drift.
  const changedTargetMode: ActiveAirconMode | null = reopened
    ? airconUserModeIntent(targetTemperature, currentTemperature) ?? null
    : null;
  if (
    running &&
    changedTargetMode &&
    changedTargetMode !== running &&
    airconSupportsHvacMode(entity, changedTargetMode)
  ) {
    const fanStep = airconFanStepForTemperatureDelta(delta);
    const cycle = autoPlanState(cycleBase, {
      ...served,
      lastMode: changedTargetMode,
      lastModeAt: now,
      lastTransitionAt: now,
      recentStartsAt: [...recentStartsAt, now],
      settlingFromTemperature: null,
    });
    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: changedTargetMode,
        entity,
        fanStep,
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      nextState: cycle,
      reason: "driving",
      wantedMode: changedTargetMode,
    };
  }

  const rest = (reason: AirconAutoReason, overrides: Partial<AirconAutoState> = {}): AirconAutoPlan => {
    // A hold is a deferral, so it keeps the latch. Everything else here is an
    // answer — the target is met, or it cannot be served — so it clears it.
    const settles = reason === "mode-hold" || reason === "sensor-settling-hold" || reason === "min-cycle-hold"
      ? {}
      : served;
    const base = autoPlanState(cycleBase, { ...settles, ...overrides });
    if (!isClimateEntityOn(entity)) {
      return { actions: [], nextState: base, reason };
    }
    // Stopping is never rate-limited, but it IS a transition: the dwell before the
    // next start counts from here. Stamp it BEFORE building the actions, because
    // the stamped value is what rides out on the turn_off's remember payload.
    const cycle = autoPlanState(base, {
      lastTransitionAt: now,
      settlingFromTemperature: currentTemperature,
    });
    return {
      actions: offAutoActions({ cycle, entity, selectedMode, targetTemperature }),
      nextState: cycle,
      reason,
    };
  };

  // ---- Already driving: run until the reading reaches target, then stop. ----
  //
  // While driving, the wanted direction cannot disagree with the running one —
  // "not yet at target" and "wanted the other way" are contradictory — so no
  // reversal is reachable from here at all. The asymmetric behavior is: stop at
  // target now, but only restart from the trusted post-settling reading below.
  if (running) {
    const reachedTarget = running === "heat" ? currentTemperature >= targetTemperature : currentTemperature <= targetTemperature;
    if (reachedTarget) {
      return rest("reached-target");
    }

    const fanStep = airconFanStepForTemperatureDelta(delta);
    const cycle = autoPlanState(cycleBase, {
      ...served,
      lastMode: running,
      lastModeAt: currentState.lastModeAt ?? now,
      settlingFromTemperature: null,
    });
    return {
      actions: activeAutoActions({
        cycle,
        desiredMode: running,
        entity,
        fanStep,
        forceRemember,
        quietSwitch,
        targetTemperature,
        turboSwitch,
      }),
      // Continuing in the same direction is not a transition and not a start, so
      // neither clock is stamped. A fan step is not a compressor cycle.
      nextState: cycle,
      reason: "driving",
      wantedMode: running,
    };
  }

  // ---- Resting: decide whether to start, and whether we are allowed to. ----
  //
  // A target the user moved (or a freshly pressed Auto) only has to point away
  // from the room at all. Normal same-direction cycling resumes on the first
  // whole degree after the off sensor has settled; a reversal needs three.
  const wantedMode = desiredModeForDelta(delta);
  const resumeDegrees = currentState.lastMode && currentState.lastMode !== wantedMode
    ? AIRCON_AUTO_DIRECTION_CHANGE_DEGREES
    : AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES;
  const needsDriving = reopened ? absDelta > 0 : absDelta >= resumeDegrees;
  if (!needsDriving) {
    return rest("resting");
  }

  if (!airconSupportsHvacMode(entity, wantedMode)) {
    // Can't drive the room toward target in the needed direction; rest rather
    // than run uselessly.
    return { ...rest("unsupported-direction"), wantedMode };
  }

  // Flip-flop guard. Reversing direction is held for AIRCON_AUTO_MODE_HOLD_MS
  // from the last direction change, and resting is the honest answer while it
  // holds: running the old direction would drive the room further from target.
  // Note lastModeAt is deliberately NOT restamped — being blocked must not
  // extend the hold, or a persistently wrong reading would freeze Auto forever.
  // A user who actually wants the other direction clears it (ClimateControls).
  if (
    !reopened &&
    currentState.lastMode &&
    currentState.lastMode !== wantedMode &&
    currentState.lastModeAt !== null &&
    now - currentState.lastModeAt < AIRCON_AUTO_MODE_HOLD_MS
  ) {
    return { ...rest("mode-hold"), wantedMode };
  }

  const settlingElapsedMs = currentState.lastTransitionAt === null
    ? Number.POSITIVE_INFINITY
    : now - currentState.lastTransitionAt;
  const sameDirectionTrendSupportsRestart =
    currentState.lastMode === wantedMode &&
    settlingElapsedMs >= AIRCON_AUTO_MIN_CYCLE_MS &&
    settlingTrendSupportsSameDirectionRestart({
      direction: wantedMode,
      atTransition: currentState.settlingFromTemperature,
      current: currentTemperature,
      target: targetTemperature,
      elapsedMs: settlingElapsedMs,
      timeConstantMs: AIRCON_SENSOR_TIME_CONSTANT_MS,
      resumeDriftC: AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES,
      measurementResolutionC: AIRCON_SENSOR_RESOLUTION_DEGREES,
    });

  // A stopped indoor unit has almost no airflow over its enclosed sensor. Before
  // the full fallback timeout, start only when its monotonic post-stop trend and
  // first-order extrapolated equilibrium both say the unchanged target is still
  // unmet in the SAME direction. Ambiguous traces wait the full 30 minutes.
  if (
    !reopened &&
    currentState.lastTransitionAt !== null &&
    settlingElapsedMs < AIRCON_SENSOR_SETTLE_MS &&
    !sameDirectionTrendSupportsRestart
  ) {
    return { ...rest("sensor-settling-hold"), wantedMode };
  }

  // Minimum dwell before restarting the compressor. Unlike the bedroom heater's
  // equivalent this gates STARTS ONLY — see the header note on why a guard must
  // never be the reason the unit keeps running.
  //
  // rest() rather than "do nothing": on the normal path the unit is already off
  // and rest() emits nothing, but if it is sitting in fan_only or dry — a mode
  // Auto never selects, so someone else put it there — being held off a start is
  // no reason to leave it running.
  if (
    !reopened &&
    currentState.lastTransitionAt !== null &&
    now - currentState.lastTransitionAt < AIRCON_AUTO_MIN_CYCLE_MS
  ) {
    return { ...rest("min-cycle-hold"), wantedMode };
  }

  const fanStep = airconFanStepForTemperatureDelta(delta);
  const modeChanged = currentState.lastMode !== wantedMode;
  const cycle: AirconAutoState = {
    ...cycleBase,
    ...served,
    lastMode: wantedMode,
    lastModeAt: modeChanged ? now : currentState.lastModeAt ?? now,
    lastTransitionAt: now,
    recentStartsAt: [...recentStartsAt, now],
    settlingFromTemperature: null,
  };

  return {
    actions: activeAutoActions({
      cycle,
      desiredMode: wantedMode,
      entity,
      fanStep,
      forceRemember,
      quietSwitch,
      targetTemperature,
      turboSwitch,
    }),
    nextState: cycle,
    reason: "driving",
    wantedMode,
  };
}

export function buildAirconAutoActions(args: AirconAutoPlanInput) {
  return planAirconAutoTick(args).actions;
}

