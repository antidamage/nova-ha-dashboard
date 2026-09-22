import { defaultDriverFor } from "./catalogue";
import type { ControlModule, ControlPreset } from "./types";

/**
 * Starting a new preset (specs/control-modules.md).
 *
 * Both a new id and a new name are made unique up front. Two presets sharing a
 * name collide once the list is stored, and a collision a store resolves
 * silently reads to the owner as a control she just created that vanished —
 * so a duplicate is never reachable by pressing "Add preset" twice.
 */

export function uniquePresetId(moduleId: string, existing: readonly ControlPreset[]): string {
  const base = moduleId.replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  const taken = new Set(existing.map((preset) => preset.id));
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function uniquePresetName(
  name: string,
  existing: readonly ControlPreset[],
  ignorePresetId?: string,
): string {
  const taken = new Set(
    existing.filter((preset) => preset.id !== ignorePresetId).map((preset) => preset.name.trim().toLowerCase()),
  );
  if (!taken.has(name.trim().toLowerCase())) {
    return name;
  }
  for (let index = 2; index < 500; index += 1) {
    const candidate = `${name} ${index}`;
    if (!taken.has(candidate.trim().toLowerCase())) {
      return candidate;
    }
  }
  return `${name} ${Date.now().toString(36)}`;
}

/** A fresh preset: the variant's first driver, an unused id and an unused name. */
export function newPreset(
  module: ControlModule,
  modules: readonly ControlModule[],
  existing: readonly ControlPreset[],
  roomId: string | null = null,
): ControlPreset {
  const variant = module.variants[0]?.id ?? null;
  const driver = module.renderer ? defaultDriverFor(modules, module.renderer, variant) : null;
  return {
    id: uniquePresetId(module.id, existing),
    moduleId: module.id,
    name: uniquePresetName(module.name, existing),
    roomId,
    driverId: driver?.id ?? null,
    variant,
    features: {},
    binding: {},
  };
}
