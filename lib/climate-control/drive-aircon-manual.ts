import {
  AIRCON_SENSOR_RESOLUTION_DEGREES,
  AIRCON_SENSOR_SETTLE_MS,
  AIRCON_SENSOR_TIME_CONSTANT_MS,
  AIRCON_USER_REQUEST_MAX_AGE_MS,
  isClimateEntityOn,
} from "../aircon-control";
import { planManualAirconTick } from "../climate-control-policy";
import type { AirconInstance } from "../climate-instances";
import type { AirconPreferences, DashboardEntity } from "../types";
import { AIRCON_MIN_OFF_MS, AIRCON_SAME_DIRECTION_RESUME_DRIFT_C } from "./constants";
import { emitClimateControllerWrite } from "./attribution";
import { executeActions } from "./commands";
import { pruneStarts } from "./device-model";
import type { PersistedRoom } from "./types";

/**
 * One tick of Manual: the thermostat the owner's chosen direction runs on.
 *
 * Manual is not a hand on the switch (specs/aircon-auto-control.md §5.1). It
 * starts the unit to reach the target, stops it on arrival, and starts it again
 * when the room drifts past the resume band — under the same compressor dwell and
 * settling rules as Auto. It never changes the selected mode; the caller reports
 * `restingNow` as a phase, not as Off.
 *
 * Returns whether this tick rested the unit.
 */
export async function driveManualAircon({
  aircon,
  direction,
  filteredTemperature,
  now,
  prefs,
  rawTemperature,
  room,
  unit,
}: {
  aircon: DashboardEntity;
  direction: "heat" | "cool";
  filteredTemperature: number | null;
  now: number;
  prefs?: AirconPreferences;
  rawTemperature: number | null;
  room: PersistedRoom;
  unit: AirconInstance;
}): Promise<boolean> {
  const target = prefs?.temperature ?? Number(aircon.attributes.temperature);
  pruneStarts(room, now);
  // Latch a target the owner moved, exactly as Auto does. Read as a number
  // rather than against null so a state file written before this field existed
  // does not read as a change on the first tick after a deploy.
  if (Number.isFinite(target)) {
    if (typeof room.manualTargetTemperature === "number" && room.manualTargetTemperature !== target) {
      room.manualUserRequestAt = now;
    }
    room.manualTargetTemperature = target;
  }
  if (
    typeof room.manualUserRequestAt === "number" &&
    now - room.manualUserRequestAt >= AIRCON_USER_REQUEST_MAX_AGE_MS
  ) {
    room.manualUserRequestAt = null;
  }
  const userRequested = typeof room.manualUserRequestAt === "number";
  /** No usable reading: nothing says when to stop, so we do not run (§5.2). */
  const blind = rawTemperature === null;
  const decision = Number.isFinite(target)
    ? planManualAirconTick({
        direction,
        isOn: isClimateEntityOn(aircon),
        userRequested,
        rawTemperature,
        filteredTemperature,
        targetTemperature: target,
        now,
        lastTransitionAt: room.lastTransitionAt,
        settlingFromTemperature: room.settlingFromTemperature,
        minOffMs: AIRCON_MIN_OFF_MS,
        sensorSettleMs: AIRCON_SENSOR_SETTLE_MS,
        sensorResolutionC: AIRCON_SENSOR_RESOLUTION_DEGREES,
        sensorTimeConstantMs: AIRCON_SENSOR_TIME_CONSTANT_MS,
        resumeDriftC: AIRCON_SAME_DIRECTION_RESUME_DRIFT_C,
      })
    : "hold";
  // Every outcome above is an answer once a request is latched — driving already,
  // started now, or the target is met — so none of them defer it.
  if (userRequested) room.manualUserRequestAt = null;

  if (decision === "stop") {
    room.lastTransitionAt = now;
    room.settlingFromTemperature = rawTemperature;
    room.lastStopReason = blind ? "sensor-unavailable" : "target-reached";
    if (blind) {
      // Nova switching her unit off with nobody asking: explainable after the
      // fact, and Manual stays selected (specs/aircon-auto-control.md §5.2).
      emitClimateControllerWrite({
        instanceId: unit.id,
        reason: "sensor-unavailable",
        modeBefore: "manual",
        modeAfter: "manual",
        target: Number.isFinite(target) ? target : undefined,
        sensorTemperature: null,
        sensorAgeSeconds: null,
        sensorUnusableReason: "stale-or-non-numeric",
      });
    }
    await executeActions(unit, [{ entityId: aircon.entity_id, domain: "climate", service: "turn_off" }]);
    // Manual stays selected and keeps running its rules; only the phase changes.
    return true;
  }

  if (decision === "start") {
    room.lastTransitionAt = now;
    room.settlingFromTemperature = null;
    room.recentStartsAt.push(now);
    await executeActions(unit, [{
      entityId: aircon.entity_id,
      domain: "climate",
      service: "set_hvac_mode",
      data: { hvac_mode: direction },
    }]);
  }

  return false;
}
