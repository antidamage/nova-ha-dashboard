import type { AirconPreferences, DashboardEntity } from "../types";
import type { AirconFanStep } from "./constants";
import type { ActiveAirconMode, AirconAutoState, EntityActionInput } from "./types";
import { climateTargetTemperature, isClimateEntityOn } from "./entity-model";
import { airconFanModeServiceValue } from "./mode-model";
import { activeAutoRemember, inactiveAutoRemember } from "./cycle-model";

export function airconFanStepActions({
  entity,
  quietSwitch,
  remember,
  step,
  turboSwitch,
}: {
  entity: DashboardEntity;
  quietSwitch?: DashboardEntity;
  remember?: AirconPreferences;
  step: AirconFanStep;
  turboSwitch?: DashboardEntity;
}) {
  const actions: EntityActionInput[] = [];
  const quietEnabled = step === "quiet";
  const turboEnabled = step === "turbo";
  const fanMode = airconFanModeServiceValue(step);

  if (quietSwitch && (quietSwitch.state === "on") !== quietEnabled) {
    actions.push({
      entityId: quietSwitch.entity_id,
      domain: "switch",
      service: quietEnabled ? "turn_on" : "turn_off",
    });
  }
  if (turboSwitch && (turboSwitch.state === "on") !== turboEnabled) {
    actions.push({
      entityId: turboSwitch.entity_id,
      domain: "switch",
      service: turboEnabled ? "turn_on" : "turn_off",
    });
  }
  if (String(entity.attributes.fan_mode ?? "").toLowerCase() !== fanMode) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_fan_mode",
      data: { fan_mode: fanMode },
    });
  }

  if (remember && actions.length) {
    actions[actions.length - 1] = {
      ...actions[actions.length - 1],
      remember: { aircon: remember },
    };
  }

  return actions;
}

export function activeAutoActions({
  cycle,
  desiredMode,
  entity,
  fanStep,
  forceRemember,
  quietSwitch,
  targetTemperature,
  turboSwitch,
}: {
  cycle: AirconAutoState;
  desiredMode: ActiveAirconMode;
  entity: DashboardEntity;
  fanStep: AirconFanStep;
  forceRemember: boolean;
  quietSwitch?: DashboardEntity;
  targetTemperature: number;
  turboSwitch?: DashboardEntity;
}) {
  const isOn = isClimateEntityOn(entity);
  const remember = activeAutoRemember(targetTemperature, desiredMode, fanStep, cycle);
  const actions: EntityActionInput[] = [];
  const modeNeedsChange = entity.state !== desiredMode || forceRemember;

  // set_hvac_mode turns the unit on by itself, so a turn_on in front of it buys
  // nothing and costs a real state change in the OLD mode: the 2026-08-09
  // logbook shows turn_on -> "heat" followed 90 ms later by
  // set_hvac_mode -> "cool", three times. Only turn_on when no mode change is
  // going out to do it for us.
  if (!isOn && !modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "turn_on",
    });
  }

  if (modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_hvac_mode",
      data: { hvac_mode: desiredMode },
      remember: { aircon: remember },
    });
  }

  if (!isOn || climateTargetTemperature(entity) !== targetTemperature || modeNeedsChange) {
    actions.push({
      entityId: entity.entity_id,
      domain: "climate",
      service: "set_temperature",
      data: { hvac_mode: desiredMode, temperature: targetTemperature },
      remember: { aircon: remember },
    });
  }

  actions.push(...airconFanStepActions({ entity, quietSwitch, remember, step: fanStep, turboSwitch }));

  return actions;
}

// When the room reaches target (or auto is not allowed to drive it in the needed
// direction), the loop switches the unit OFF. This is idempotent: an already-off
// unit yields no actions, so the 1s loop stops re-sending once it has switched
// off. The remembered preference keeps autoMode:true, so the dashboard still
// reads "Auto" while the unit rests off rather than flipping to "Off".
export function offAutoActions({
  cycle,
  entity,
  selectedMode,
  targetTemperature,
}: {
  cycle: AirconAutoState;
  entity: DashboardEntity;
  selectedMode?: string;
  targetTemperature: number;
}): EntityActionInput[] {
  if (!isClimateEntityOn(entity)) {
    return [];
  }

  return [
    {
      entityId: entity.entity_id,
      domain: "climate",
      service: "turn_off",
      remember: { aircon: inactiveAutoRemember(targetTemperature, selectedMode, cycle) },
    },
  ];
}

