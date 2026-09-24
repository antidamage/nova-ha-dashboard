import { airconInstances, heaterInstances } from "../climate-instances";
import type { DashboardConfig } from "../config-schema";
import { controlModuleIn, CONTROL_MODULES, driverModulesFor } from "./catalogue";
import { panelContentPresets, panelContentSlots } from "./panel-surfaces";
import { HOME_ZONE_ID } from "./rooms";
import { hasStoredPresets, storedPresets, storedSlots } from "./stored";
import type {
  ControlModule,
  ControlPreset,
  ControlSlot,
  ControlsConfig,
  PresetProblem,
} from "./types";

/**
 * The preset model: what the dashboard is actually backed by
 * (specs/control-modules.md).
 *
 * Two sources, in one direction only. A stored preset list wins outright; with
 * none stored the whole set is DERIVED from the rest of the config, which is
 * what lets the Devices tab show a home's real devices the first time it is
 * opened without anything having been migrated. The moment a preset is saved the
 * stored list becomes the whole truth — a half-derived, half-stored mix would be
 * two answers to "which aircon is the lounge card showing?".
 */

export const AIRCON_HEATER_MODULE = "aircon-heater-control";
// The panels and the module their own content is placed as live in
// `panel-surfaces.ts`; this file only has to ask for them.
export { PANEL_CONTENT_MODULE, PANEL_SURFACES } from "./panel-surfaces";
export const ROOM_LIGHTING_MODULE = "room-lighting";
export const AMPLIFIER_MODULE = "amplifier-control";
export const OUTSIDE_WEATHER_MODULE = "outside-weather";
export const GREE_DRIVER = "gree-air-conditioner";
export const HEATER_SWITCH_DRIVER = "sample-heater-wifi-switch";

export const QUICK_ACCESS_LIGHTS_SLOT = "quick-access-lights";
export const QUICK_ACCESS_AMPLIFIER_SLOT = "quick-access-amplifier";
export const QUICK_ACCESS_CLIMATE_PREFIX = "quick-access-climate-";
export const QUICK_ACCESS_OUTSIDE_SLOT = "quick-access-outside";

/** A climate preset's id is its instance id, so an adopted one keeps its settings. */
function airconPreset(config: DashboardConfig): ControlPreset[] {
  return airconInstances(config).map((instance) => ({
    id: instance.id,
    moduleId: AIRCON_HEATER_MODULE,
    name: instance.title,
    roomId: instance.zoneId ?? null,
    driverId: GREE_DRIVER,
    variant: "aircon",
    features: {},
    binding: {
      entityId: instance.entityId,
      matchTokens: instance.matchTokens,
      temperatureEntityIds: instance.temperatureEntityIds ?? [],
      humidityEntityIds: instance.humidityEntityIds ?? [],
      dryTargetHumidityPct: instance.dryTargetHumidityPct,
    },
  }));
}

function heaterPreset(config: DashboardConfig): ControlPreset[] {
  return heaterInstances(config).map((instance) => ({
    id: instance.id,
    moduleId: AIRCON_HEATER_MODULE,
    name: instance.title,
    roomId: instance.zoneId ?? null,
    driverId: HEATER_SWITCH_DRIVER,
    variant: "heater",
    features: {},
    binding: {
      switchEntityIds: instance.switchEntityIds,
      temperatureEntityIds: instance.temperatureEntityIds,
      humidityEntityIds: instance.humidityEntityIds,
    },
  }));
}

/**
 * The set a home that has never opened the Devices tab is backed by: the climate
 * devices the config already declares, the zone the card's lights already
 * control, and the outside readings. Deliberately the same order and the same
 * contents the Quick Access card had before it was configurable.
 */
export function derivedPresets(config: DashboardConfig): ControlPreset[] {
  return [
    ...airconPreset(config),
    ...heaterPreset(config),
    {
      id: "home-lights",
      moduleId: ROOM_LIGHTING_MODULE,
      name: "Lights",
      roomId: HOME_ZONE_ID,
      driverId: null,
      variant: null,
      features: {},
      binding: {},
    },
    {
      id: "amplifier",
      moduleId: AMPLIFIER_MODULE,
      name: "Amplifier",
      roomId: null,
      driverId: null,
      variant: null,
      features: {},
      binding: {},
    },
    {
      id: "outside",
      moduleId: OUTSIDE_WEATHER_MODULE,
      name: "Outside",
      roomId: null,
      driverId: null,
      variant: null,
      features: {},
      binding: {},
    },
    // And one per panel, holding that panel's own content.
    ...panelContentPresets(),
  ];
}

export function derivedSlots(config: DashboardConfig): ControlSlot[] {
  const climate = derivedPresets(config).filter((preset) => preset.moduleId === AIRCON_HEATER_MODULE);
  return [
    { id: QUICK_ACCESS_LIGHTS_SLOT, surface: "quick-access", presetId: "home-lights", roomId: HOME_ZONE_ID, visible: true },
    { id: QUICK_ACCESS_AMPLIFIER_SLOT, surface: "quick-access", presetId: "amplifier", roomId: null, visible: true },
    ...climate.map((preset) => ({
      id: `${QUICK_ACCESS_CLIMATE_PREFIX}${preset.id}`,
      surface: "quick-access" as const,
      presetId: preset.id,
      roomId: null,
      visible: true,
    })),
    { id: QUICK_ACCESS_OUTSIDE_SLOT, surface: "quick-access", presetId: "outside", roomId: null, visible: true },
    ...panelContentSlots(),
  ];
}

/** What the dashboard is backed by: stored configuration, or the derivation. */
export function effectiveControls(config: DashboardConfig): ControlsConfig {
  if (hasStoredPresets(config)) {
    return { presets: storedPresets(config), slots: storedSlots(config) };
  }
  return { presets: derivedPresets(config), slots: derivedSlots(config) };
}

export function effectivePresets(config: DashboardConfig): ControlPreset[] {
  return effectiveControls(config).presets;
}

export function presetsForModule(presets: readonly ControlPreset[], moduleId: string): ControlPreset[] {
  return presets.filter((preset) => preset.moduleId === moduleId);
}

export function presetById(presets: readonly ControlPreset[], id: string): ControlPreset | null {
  return presets.find((preset) => preset.id === id) ?? null;
}

/** The module a preset belongs to, or null when it names one this build lacks. */
export function presetModule(preset: ControlPreset, modules: readonly ControlModule[]): ControlModule | null {
  return controlModuleIn(modules, preset.moduleId);
}

/**
 * A fresh preset for a module: the variant's first driver and a name that is
 * already unique. Moved out to `preset-draft.ts`, which explains why.
 */
export { newPreset, uniquePresetId, uniquePresetName } from "./preset-draft";

/** Every problem that would stop a preset working, in the owner's terms. */
export function presetProblems(presets: readonly ControlPreset[], modules: readonly ControlModule[]): PresetProblem[] {
  const problems: PresetProblem[] = [];
  const ids = new Set<string>();
  for (const preset of presets) {
    const module = controlModuleIn(modules, preset.moduleId);
    if (!module) {
      problems.push({ presetId: preset.id, field: "moduleId", message: `No module called "${preset.moduleId}" is installed`, severity: "error" });
      continue;
    }
    if (ids.has(preset.id)) {
      problems.push({ presetId: preset.id, field: "id", message: "Two presets share this id; one of them is invisible", severity: "error" });
    }
    ids.add(preset.id);

    if (module.variants.length && !module.variants.some((variant) => variant.id === preset.variant)) {
      problems.push({ presetId: preset.id, field: "variant", message: `Choose whether this is a ${module.variants.map((v) => v.label.toLowerCase()).join(" or a ")}`, severity: "error" });
    }
    if (module.renderer) {
      const accepted = driversFor(module, preset.variant, modules);
      if (accepted.length && !accepted.some((driver) => driver.id === preset.driverId)) {
        problems.push({
          presetId: preset.id,
          field: "driverId",
          message: accepted.length === 1 ? `Assign ${accepted[0].name}` : `Assign a driver: ${accepted.map((driver) => driver.name).join(", ")}`,
          severity: "error",
        });
      }
    }
    const driver = preset.driverId ? controlModuleIn(modules, preset.driverId) : null;
    for (const field of editorFields(module, driver)) {
      if (!field.required) continue;
      const value = preset.binding[field.id];
      const missing = value === undefined || (Array.isArray(value) && value.length === 0);
      if (missing) {
        problems.push({ presetId: preset.id, field: field.id, message: `No ${field.label.toLowerCase()} yet`, severity: "warning" });
      }
    }
  }
  return problems;
}

/**
 * The drivers a preset of this control may be assigned. A control with no
 * renderer is a driver itself; a variant of a control with no drivers is a
 * control that runs on its own.
 */
export function driversFor(
  module: ControlModule,
  variant: string | null,
  modules: readonly ControlModule[],
): ControlModule[] {
  if (!module.renderer) {
    return [];
  }
  const pluggable = driverModulesFor(modules, module.renderer, variant);
  // The control's own list is a narrowing, not a second source of truth: a
  // control that names the drivers it accepts must not be offered one it does
  // not, and an empty list keeps meaning "any that plugs in".
  return module.driverIds.length
    ? pluggable.filter((driver) => module.driverIds.includes(driver.id))
    : pluggable;
}

/**
 * The fields the editor shows: the control's own plus the selected driver's,
 * deduped by id. What the control contributes is what every variant shares; what
 * the driver contributes is what its hardware needs.
 */
export function editorFields(module: ControlModule, driver: ControlModule | null) {
  const fields = [...module.fields];
  for (const field of driver?.fields ?? []) {
    if (!fields.some((existing) => existing.id === field.id)) {
      fields.push(field);
    }
  }
  return fields;
}

/** Every module grouped for the Devices tab, drivers beside the controls they plug into. */
export function moduleCatalog(modules: readonly ControlModule[] = CONTROL_MODULES) {
  return {
    controls: modules.filter((module) => module.layer === "control"),
    drivers: modules.filter((module) => module.layer === "driver"),
  };
}

export type { ControlsConfig };
