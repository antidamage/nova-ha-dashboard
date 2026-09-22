import type { AirconInstance, ClimateInstance, HeaterInstance } from "../climate-instances";
import type { DashboardConfig } from "../config-schema";
import type { ControlPreset, ControlSlot, ControlsConfig } from "./types";

/**
 * The stored control configuration, and the only place a preset is turned back
 * into a climate instance (specs/control-modules.md).
 *
 * A preset IS the device declaration once one has been saved: `id` is the
 * instance id that keys the room's control state and remembered settings, so a
 * preset adopted from the legacy config keeps the settings it already had. This
 * module deliberately imports `climate-instances` for TYPES only — the runtime
 * dependency runs the other way, and a cycle here would be a load-order bug
 * nobody would see until a heater stopped answering.
 */

/** This installation's climate-instance key for a preset. */
export const AIRCON_CONTROL_MODULE = "aircon-heater-control";

const EMPTY: ControlsConfig = { presets: [], slots: [] };

/**
 * The stored block, tolerating a config document that predates it.
 *
 * A merged config always carries it (zod defaults it), but a hand-built one —
 * a fixture, an older document read before validation — must not take the whole
 * dashboard down through a property read. An absent block means "nothing
 * stored", which is exactly the derived path.
 */
function storedControls(config: DashboardConfig): ControlsConfig {
  return (config.dashboard as { controls?: ControlsConfig }).controls ?? EMPTY;
}

export function storedPresets(config: DashboardConfig): ControlPreset[] {
  return storedControls(config).presets;
}

export function storedSlots(config: DashboardConfig): ControlSlot[] {
  return storedControls(config).slots;
}

/**
 * Whether this install has been configured by hand, or is still on the derivation.
 *
 * The flag, not the list's length: a saved list with no presets in it is the
 * owner saying "show nothing", and deriving over that would resurrect every
 * control she just removed.
 */
export function hasStoredPresets(config: DashboardConfig): boolean {
  return storedControls(config).configured === true;
}

export function isClimatePreset(preset: ControlPreset): boolean {
  return preset.moduleId === AIRCON_CONTROL_MODULE;
}

export function climatePresets(config: DashboardConfig): ControlPreset[] {
  return storedPresets(config).filter(isClimatePreset);
}

export function presetToAirconInstance(preset: ControlPreset): AirconInstance {
  return {
    kind: "aircon",
    id: preset.id,
    title: preset.name,
    zoneId: preset.roomId ?? undefined,
    entityId: preset.binding.entityId,
    matchTokens: preset.binding.matchTokens ?? [],
    temperatureEntityIds: preset.binding.temperatureEntityIds ?? [],
    humidityEntityIds: preset.binding.humidityEntityIds ?? [],
    dryTargetHumidityPct: preset.binding.dryTargetHumidityPct,
  };
}

export function presetToHeaterInstance(preset: ControlPreset): HeaterInstance {
  return {
    kind: "heater",
    id: preset.id,
    title: preset.name,
    zoneId: preset.roomId ?? undefined,
    switchEntityIds: preset.binding.switchEntityIds ?? [],
    temperatureEntityIds: preset.binding.temperatureEntityIds ?? [],
    humidityEntityIds: preset.binding.humidityEntityIds ?? [],
  };
}

/** The climate instances a stored preset list declares. Empty when there are none. */
export function climateInstancesFromPresets(config: DashboardConfig): ClimateInstance[] {
  const instances: ClimateInstance[] = [];
  for (const preset of climatePresets(config)) {
    if (preset.variant === "heater") {
      instances.push(presetToHeaterInstance(preset));
    } else if (preset.variant !== null) {
      instances.push(presetToAirconInstance(preset));
    }
  }
  return instances;
}
