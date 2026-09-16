// Status Orb module format: per-frame resolution of module settings, layer
// gates and setting-bound layer parameters.

import type { OrbLayerGate, OrbSettingValue } from "./types";
import type { OrbModule } from "./layer-types";
import { clamp } from "./value-model";

/**
 * Is a layer's gate satisfied for this frame? An absent setting reads as 0
 * (see OrbLayerGate), so one of a gated pair always draws.
 */
export function orbLayerGateOpen(
  gate: OrbLayerGate | undefined,
  settings: Record<string, number> | undefined,
): boolean {
  if (!gate) return true;
  const raw = Number(settings?.[gate.setting]);
  const value = Number.isFinite(raw) ? raw : 0;
  if (gate.min !== undefined && value < gate.min) return false;
  if (gate.max !== undefined && value > gate.max) return false;
  return true;
}

/**
 * Resolve a module's saved per-setting overrides (the avatar theme's
 * `orbModuleSettings[module.id]`) into a complete id -> value map: declared
 * defaults filled in, saved values clamped to the declared range. Shared by
 * the renderer (per frame) and the config UI (slider values).
 */
export function resolveOrbModuleSettings(
  module: OrbModule,
  saved?: Record<string, number> | null,
): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const decl of module.settings ?? []) {
    const raw = Number(saved?.[decl.id]);
    resolved[decl.id] = Number.isFinite(raw) ? clamp(raw, decl.min, decl.max) : decl.default;
  }
  return resolved;
}

/**
 * Resolve a literal-or-setting-bound layer parameter for one frame. Bindings
 * to ids absent from `settings` fall back to the caller's default — that is
 * the degrade rule for foreign/unknown setting refs.
 */
export function orbSettingNumber(
  value: OrbSettingValue | undefined,
  settings: Record<string, number> | undefined,
  fallback: number,
): number {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    const bound = settings?.[value.setting];
    if (bound !== undefined && Number.isFinite(bound)) {
      return bound;
    }
  }
  return fallback;
}
