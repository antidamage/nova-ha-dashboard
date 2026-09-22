"use client";

import { featureApplies } from "../../../../lib/control-modules/features";
import { behaviourLabel } from "../../../../lib/control-modules/renderers";
import { roomLabel } from "../../../../lib/control-modules/rooms";
import type { RoomOption } from "../../../../lib/control-modules/rooms";
import type {
  ControlModule,
  ControlModuleField,
  ControlPreset,
  ControlsConfig,
  PresetProblem,
} from "../../../../lib/control-modules/types";

/**
 * Reading a preset in the owner's words (specs/control-modules.md).
 *
 * The Devices tab is a list of device types with their presets under them, and
 * every line of it has to be comprehensible at a glance: what this preset is,
 * what it drives, which room it serves, and what is still missing. That
 * derivation lives here, in one place, so the collapsed row, the editor and the
 * Quick Access slot list cannot describe the same preset three ways.
 */

export type PresetFacts = {
  module: ControlModule | null;
  driver: ControlModule | null;
  /** "Gree Air Conditioner" — the driver's own name, or the module's. */
  driverName: string;
  room: string;
  /** One line: what this preset is and what it drives. */
  summary: string;
  problems: PresetProblem[];
  placed: boolean;
};

export function presetFacts(
  preset: ControlPreset,
  modules: readonly ControlModule[],
  rooms: readonly RoomOption[],
  controls: ControlsConfig,
  problems: readonly PresetProblem[],
): PresetFacts {
  const module = modules.find((candidate) => candidate.id === preset.moduleId) ?? null;
  const driver = preset.driverId ? modules.find((candidate) => candidate.id === preset.driverId) ?? null : null;
  const variant = module?.variants.find((candidate) => candidate.id === preset.variant);
  const parts = [module?.name ?? preset.moduleId];
  if (variant) {
    parts.push(variant.label.toLowerCase());
  }
  return {
    driver,
    driverName: driver?.name ?? "no driver",
    module,
    placed: controls.slots.some((slot) => slot.presetId === preset.id),
    problems: problems.filter((problem) => problem.presetId === preset.id),
    room: roomLabel(preset.roomId, rooms),
    summary: `${parts.join(" · ")} on ${driver?.name ?? "its own behaviour"}`,
  };
}

/** The bound value of one field, as text the editor's input can hold. */
export function fieldText(field: ControlModuleField, preset: ControlPreset): string {
  const value = preset.binding[field.id];
  if (value === undefined) {
    return "";
  }
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export function placeText(place: string, separator: string) {
  return place.split(separator).map((part) => part.trim()).filter(Boolean);
}

/** The features a preset can switch, with their current values resolved. */
export function featureRows(
  module: ControlModule,
  driver: ControlModule | null,
  preset: ControlPreset,
  modules: readonly ControlModule[] = [],
): Array<{ id: string; label: string; detail: string; value: boolean; available: boolean }> {
  const nameOf = (id: string) =>
    id === driver?.id ? driver.name : modules.find((candidate) => candidate.id === id)?.name ?? id;
  const variantLabel = (ids: readonly string[]) =>
    ids.map((id) => module.variants.find((variant) => variant.id === id)?.label.toLowerCase() ?? id).join(" or ");

  return module.features.map((feature) => {
    const stored = preset.features?.[feature.id];
    // The same gate the model drops a value with, not a second copy of it.
    const applies = featureApplies(feature, preset);
    // The reason is written in words: "Needs aircon" beside a row the owner is
    // meant to understand is a raw variant id leaking into the interface.
    const needsVariant =
      feature.variantIds && !(preset.variant && feature.variantIds.includes(preset.variant))
        ? `Only for the ${variantLabel(feature.variantIds)}`
        : null;
    const needsDriver = feature.driverIds
      ? `Needs ${feature.driverIds.map(nameOf).join(" or ")}`
      : null;
    return {
      available: applies,
      detail: applies ? feature.detail : needsVariant ?? needsDriver ?? feature.detail,
      id: feature.id,
      label: feature.label,
      value: typeof stored === "boolean" ? stored : feature.default,
    };
  });
}

/** The behaviour labels a control links into, or a driver provides. */
export function behaviourRows(module: ControlModule) {
  return module.behaviours.map((id) => ({ id, ...behaviourLabel(id) }));
}