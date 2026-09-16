import type { AirconPreferences, DashboardEntity } from "../types";
import { AIRCON_FAN_STEPS, AIRCON_MODES, type AirconFanStep, type AirconMode } from "./constants";
import type { ActiveAirconMode } from "./types";
import { isClimateEntityOn, stringListAttribute } from "./entity-model";

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function isAirconMode(value?: string): value is AirconMode {
  return AIRCON_MODES.some((mode) => mode === value);
}

export function airconEntityMode(entity: DashboardEntity) {
  return isAirconMode(entity.state) ? entity.state : undefined;
}

export function displayedAirconMode(entity: DashboardEntity, settings: AirconPreferences): AirconMode | undefined {
  if (settings.autoMode) {
    return "auto";
  }

  const selectedMode = isAirconMode(settings.hvacMode) ? settings.hvacMode : undefined;
  const entityMode = airconEntityMode(entity);

  if (entityMode && selectedMode && entityMode !== selectedMode && isClimateEntityOn(entity)) {
    return entityMode;
  }

  return selectedMode ?? entityMode;
}

export function airconModeSupported(supportedModes: string[], mode: AirconMode) {
  return supportedModes.length === 0 || supportedModes.includes(mode);
}

export function airconAutoSupported(supportedModes: string[]) {
  return supportedModes.length === 0 || (supportedModes.includes("heat") && supportedModes.includes("cool"));
}

export function airconFanStep(
  entity: DashboardEntity,
  quietSwitch?: DashboardEntity,
  turboSwitch?: DashboardEntity,
): AirconFanStep {
  if (quietSwitch?.state === "on") {
    return "quiet";
  }
  if (turboSwitch?.state === "on") {
    return "turbo";
  }

  const mode = String(entity.attributes.fan_mode ?? "").toLowerCase();
  return AIRCON_FAN_STEPS.includes(mode as AirconFanStep) && mode !== "quiet" && mode !== "turbo"
    ? (mode as AirconFanStep)
    : "medium";
}

export function airconFanModeServiceValue(step: AirconFanStep) {
  return step === "quiet" ? "low" : step === "turbo" ? "high" : step;
}

export function desiredModeForDelta(delta: number): ActiveAirconMode {
  return delta > 0 ? "cool" : "heat";
}

/**
 * The direction a target the USER just set implies — cool below the room
 * reading, heat above it, and undefined only when the two are equal.
 *
 * This is what may break the 30-minute direction hold. **There is deliberately
 * no margin.** Adeline, 2026-09-16: "if it's too hot it needs to cool
 * immediately, and vice versa. if the user makes a mistake they can fix it."
 * A deadband here would swallow a small deliberate move and leave the unit
 * heating a room the owner just said was too hot, which is the failure they
 * actually notice; an unwanted flip is one press to undo. This replaces an
 * earlier one-degree margin that tried to tell a comfort nudge from a reversal
 * request and could not.
 *
 * It must only ever be called from a user gesture handler, never from the loop
 * — a target that merely drifted relative to the reading is not a request, and
 * without that restriction the absent margin would let Auto oscillate. The
 * sensor-driven path keeps the full 3 °C error and 30-minute hold, and those
 * are what stop Auto cycling on its own.
 */
export function airconUserModeIntent(
  targetTemperature: number,
  measuredTemperature: number | null,
): ActiveAirconMode | undefined {
  if (measuredTemperature === null || !Number.isFinite(targetTemperature)) {
    return undefined;
  }
  if (targetTemperature < measuredTemperature) {
    return "cool";
  }
  if (targetTemperature > measuredTemperature) {
    return "heat";
  }
  return undefined;
}

export function airconFanStepForTemperatureDelta(delta: number): AirconFanStep {
  const degreeSteps = Math.max(1, Math.floor(Math.abs(delta)));
  const index = clampNumber(degreeSteps - 1, 0, AIRCON_FAN_STEPS.length - 1);
  return AIRCON_FAN_STEPS[index] ?? "quiet";
}

export function airconSupportsHvacMode(entity: DashboardEntity, mode: string) {
  const supportedModes = stringListAttribute(entity, "hvac_modes");
  return supportedModes.length === 0 || supportedModes.includes(mode);
}

/** Is the unit actively driving the room in one of the two directions Auto uses? */
export function drivingMode(entity: DashboardEntity): ActiveAirconMode | undefined {
  if (!isClimateEntityOn(entity)) {
    return undefined;
  }
  return entity.state === "heat" || entity.state === "cool" ? entity.state : undefined;
}
