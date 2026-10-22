import type { AirconPreferences, DashboardEntity } from "../types";
import { AIRCON_PARK_FAN_MODE, type AirconFanStep } from "./constants";
import type { EntityActionInput } from "./types";
import { isClimateEntityOn } from "./entity-model";
import { airconSupportsHvacMode } from "./mode-model";

/**
 * Parking: where Auto and Manual rest the unit between cycles
 * (specs/aircon-auto-control.md §8).
 *
 * The Gree's return-air thermistor only reports the room while air moves over
 * it. A unit switched fully off keeps a number but not a live one, which left
 * Auto looking at a reading several degrees from the target and, correctly by
 * its own rules, not responding to it. A parked unit runs fan only at the lowest
 * speed: the compressor is stopped, the sensor stays awake.
 */

/** The compressor is, or may be, running: anything on but fan only. */
export function airconCompressorActive(entity: DashboardEntity) {
  return isClimateEntityOn(entity) && entity.state !== "fan_only";
}

/** Can this unit park at all? A unit with no fan-only mode falls back to off. */
export function airconCanPark(entity: DashboardEntity) {
  return airconSupportsHvacMode(entity, "fan_only");
}

/**
 * The actions that put the unit at rest, empty when it already is. Idempotent, so
 * the one-second loop stops sending once the unit has parked.
 *
 * The fan speed is set with no `remember`: the lowest speed is where the unit
 * waits, not a setting the owner chose, and remembering it would overwrite theirs.
 */
export function airconParkActions(entity: DashboardEntity): EntityActionInput[] {
  if (!airconCanPark(entity)) {
    return isClimateEntityOn(entity)
      ? [{ entityId: entity.entity_id, domain: "climate", service: "turn_off" }]
      : [];
  }

  const actions: EntityActionInput[] = [];
  if (entity.state !== "fan_only") {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_hvac_mode",
      data: { hvac_mode: "fan_only" },
    });
  }
  if (String(entity.attributes.fan_mode ?? "").toLowerCase() !== AIRCON_PARK_FAN_MODE) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_fan_mode",
      data: { fan_mode: AIRCON_PARK_FAN_MODE },
    });
  }
  return actions;
}

/**
 * The fan step the owner left selected, for restoring after a park lowered the
 * fan. Quiet and Turbo are switches on the unit that parking never touches, so
 * only the fan mode itself has to come back.
 */
export function airconOwnerFanStep(prefs?: AirconPreferences): AirconFanStep {
  if (prefs?.quietMode) return "quiet";
  if (prefs?.turboMode) return prefs.aggressiveMode ? "aggressive" : "turbo";
  const mode = String(prefs?.fanMode ?? "").toLowerCase();
  return mode === "low" || mode === "medium low" || mode === "medium" ||
    mode === "medium high" || mode === "high"
    ? mode
    : "medium";
}
