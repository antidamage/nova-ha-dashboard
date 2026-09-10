/**
 * Pure display rules for the Quick Access card (specs/quick-access-card.md).
 * Kept apart from the component so they can be tested without rendering.
 */
import type { BedroomHeaterMode, ClimateControlMode, DashboardEntity, DashboardZone } from "../../../lib/types";

const UNAVAILABLE_STATES = ["unavailable", "unknown"];

const AIRCON_ACTIVITY_LABELS: Record<string, string> = {
  auto: "Running",
  cool: "Cooling",
  dry: "Dry",
  fan_only: "Fan",
  heat: "Heating",
  heat_cool: "Running",
};

/**
 * One short phrase for what the air conditioner is doing. The power selection
 * decides Off; otherwise the unit's own state says what it is doing, and a
 * unit at rest under Auto or Manual is Idle. Manual has no button on the
 * compact card, so it is named here instead.
 */
export function airconStateLabel(entity: DashboardEntity | undefined, powerState: ClimateControlMode) {
  if (!entity || UNAVAILABLE_STATES.includes(entity.state)) {
    return "Unavailable";
  }
  if (powerState === "off") {
    return "Off";
  }
  const activity = entity.state === "off" ? "Idle" : AIRCON_ACTIVITY_LABELS[entity.state] ?? "Running";
  return powerState === "manual" ? `Manual · ${activity}` : activity;
}

export function heaterStateLabel(switchEntity: DashboardEntity | undefined, mode: BedroomHeaterMode) {
  if (!switchEntity || UNAVAILABLE_STATES.includes(switchEntity.state)) {
    return "Unavailable";
  }
  if (mode === "off") {
    return "Off";
  }
  return switchEntity.state === "on" ? "Heating" : "Idle";
}

/** "3 on", or "Off" when no light in the zone is lit. */
export function lightsOnLabel(zone: DashboardZone) {
  const lit = zone.entities.filter((entity) => entity.domain === "light" && entity.state === "on").length;
  return lit > 0 ? `${lit} on` : "Off";
}
