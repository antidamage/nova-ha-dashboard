import { AIRCON_BLIND_USER_START_MS } from "./constants";
import type {
  ActiveAirconMode,
  AirconAutoPlan,
  AirconAutoState,
  EntityActionInput,
} from "./types";
import type { DashboardEntity } from "../types";
import { isClimateEntityOn } from "./entity-model";
import { airconSupportsHvacMode, drivingMode } from "./mode-model";
import { autoPlanState } from "./cycle-model";
import { activeAutoActions, offAutoActions } from "./action-model";

/**
 * What Auto does with no usable room-temperature reading
 * (specs/aircon-auto-control.md §5.2).
 *
 * Adeline, 2026-09-19: "we don't run heating or cooling blind. but we do leave
 * the goddamn mode selected in case a temp value comes back." So the unit stops
 * and the loop waits — it does not guess a direction, and nothing here ever
 * cancels Auto. What this replaced: two minutes of blind running followed by a
 * "fail safe" that switched Auto itself off, leaving a dead control until
 * somebody noticed.
 *
 * The one exception is a start the owner just asked for. The Gree's thermistor
 * only reports while the unit runs, so a cold unit has no reading at all and
 * refusing to start would make the control dead exactly when she reaches for it.
 * Her press gets AIRCON_BLIND_USER_START_MS to produce one, in the direction she
 * chose or the one already running — never a guess between heat and cool.
 */
export function planAirconSensorGapTick(input: {
  entity: DashboardEntity;
  forceRemember: boolean;
  now: number;
  quietSwitch?: DashboardEntity;
  recentStartsAt: number[];
  /** Auto's stored mode preference, the only direction a blind start may use. */
  selectedMode?: string;
  state: AirconAutoState;
  targetTemperature: number;
  turboSwitch?: DashboardEntity;
  /** A target she moved, or a press of Auto. Null once served or expired. */
  userRequestAt: number | null;
}): AirconAutoPlan {
  const { entity, now, recentStartsAt, selectedMode, state, targetTemperature, userRequestAt } = input;

  const blindStartAllowed = userRequestAt !== null && now - userRequestAt < AIRCON_BLIND_USER_START_MS;
  const runningNow = drivingMode(entity);
  const attemptMode: ActiveAirconMode | undefined =
    runningNow ?? (selectedMode === "heat" || selectedMode === "cool" ? selectedMode : undefined);

  if (blindStartAllowed && attemptMode && airconSupportsHvacMode(entity, attemptMode)) {
    const pending = autoPlanState(state, {
      recentStartsAt,
      lastTargetTemperature: targetTemperature,
      sensorPendingSinceAt: state.sensorPendingSinceAt ?? now,
    });
    // Already running on her request: let it run out the window rather than
    // re-sending the same mode every tick.
    if (runningNow) {
      return { actions: [], nextState: pending, reason: "sensor-pending", wantedMode: attemptMode };
    }
    const cycle: AirconAutoState = {
      ...pending,
      lastMode: attemptMode,
      lastModeAt: state.lastMode === attemptMode ? state.lastModeAt ?? now : now,
      lastTransitionAt: now,
      recentStartsAt: [...recentStartsAt, now],
      settlingFromTemperature: null,
    };
    const actions: EntityActionInput[] = activeAutoActions({
      cycle,
      desiredMode: attemptMode,
      entity,
      fanStep: "medium",
      forceRemember: input.forceRemember,
      quietSwitch: input.quietSwitch,
      targetTemperature,
      turboSwitch: input.turboSwitch,
    });
    return { actions, nextState: cycle, reason: "sensor-pending", wantedMode: attemptMode };
  }

  // Otherwise: stop, and wait with the mode selected. offAutoActions carries
  // autoMode:true and yields nothing once the unit is already off, so the loop can
  // sit here indefinitely without touching it. The owner's request latch is
  // deliberately NOT consumed — a target moved while the sensor was missing is
  // served as soon as a reading arrives (§4).
  const stopping = isClimateEntityOn(entity);
  const cycle = autoPlanState(state, {
    recentStartsAt,
    lastTargetTemperature: targetTemperature,
    // When the reading went missing, for the public state. Kept, not cleared:
    // nothing expires off the back of it any more.
    sensorPendingSinceAt: state.sensorPendingSinceAt ?? now,
    // Only an actual stop moves the dwell clock. Stamping it every blind tick
    // would push the next start out indefinitely once a reading returned.
    ...(stopping ? { lastTransitionAt: now, settlingFromTemperature: null } : {}),
  });

  return {
    actions: offAutoActions({ cycle, entity, selectedMode, targetTemperature }),
    nextState: cycle,
    reason: "sensor-pending",
  };
}
