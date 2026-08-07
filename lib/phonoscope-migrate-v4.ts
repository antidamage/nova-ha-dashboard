import type { PhonoscopeEffectBinding, PhonoscopeSettingsGroup } from "./types";
import {
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_VIGNETTE_OPACITY_EFFECT,
} from "./phonoscope-drivers";

/**
 * v4: frame and lattice geometry became percentages.
 *
 * `__bgHeight`, `__bgWidth`, `__vignetteOpacity` and the particle lattice's
 * `grid_width` / `grid_height` were authored 0-1 as a share of the frame, and
 * are now authored 0-100 as a percentage of it. Each engine divides by 100 once,
 * where it clamps the value, so only the *authored* numbers moved.
 *
 * Without this, every stored value would clamp to near zero: a 0.33 band would
 * become 0.33% of the frame rather than 33%, and every saved settings group with
 * a driver lane sweeping one of these axes would sweep a range a hundred times
 * too small. Both the resting values and the lanes' `min`/`max` therefore scale.
 *
 * Keyed off `schemaVersion` rather than sniffed from the values, because 1 is a
 * legitimate number on both scales and there is no way to tell 1% from 100%
 * after the fact.
 *
 * This is the version *this* conversion applies below — deliberately its own
 * constant rather than "the current schema version", so that bumping the schema
 * for an unrelated change (as v5 did) does not silently re-run the percent
 * scaling over data that has already been scaled once.
 */
export const PHONOSCOPE_PERCENT_GEOMETRY_VERSION = 4;

/**
 * The lattice extent ids. These are module settings rather than picture effects,
 * so they are named literally: the manifest that declares them is the same
 * `particle-ripples` manifest whose 2.5.0 bump introduced the percentage range,
 * and a module that never had them is simply unaffected.
 */
const PERCENT_SCALED_EFFECT_IDS = new Set<string>([
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_VIGNETTE_OPACITY_EFFECT,
  "grid_width",
  "grid_height",
]);

export function isPercentScaledPhonoscopeEffect(id: string) {
  return PERCENT_SCALED_EFFECT_IDS.has(id);
}

/**
 * An absent `min`/`max` means "inherit the effect's declared default", so it
 * must stay absent rather than become an explicit undefined — the editor tells
 * the two apart.
 */
function scaledEndpoint(binding: PhonoscopeEffectBinding, key: "min" | "max") {
  const value = binding[key];
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value * 100 } : {};
}

/** Resting values held directly, keyed by effect id. */
export function migratePhonoscopeScalarsToPercent(values: Record<string, number>) {
  return Object.fromEntries(Object.entries(values).map(([id, value]) =>
    [id, isPercentScaledPhonoscopeEffect(id) && Number.isFinite(value) ? value * 100 : value]));
}

/** Per-module resting values: `moduleId -> settingId -> value`. */
export function migratePhonoscopeModuleSettingsToPercent(
  values: Record<string, Record<string, number>>,
) {
  return Object.fromEntries(Object.entries(values).map(([moduleId, settings]) =>
    [moduleId, migratePhonoscopeScalarsToPercent(settings)]));
}

/** Driver-lane bindings, whose `min`/`max` are on the effect's own axis. */
export function migratePhonoscopeSettingsGroupsToPercent(
  groups: PhonoscopeSettingsGroup[],
): PhonoscopeSettingsGroup[] {
  return groups.map((group) => ({
    ...group,
    staticSettings: migratePhonoscopeScalarsToPercent(group.staticSettings),
    lanes: group.lanes.map((lane) => ({
      ...lane,
      bindings: lane.bindings.map((binding) => isPercentScaledPhonoscopeEffect(binding.effect)
        ? { ...binding, ...scaledEndpoint(binding, "min"), ...scaledEndpoint(binding, "max") }
        : binding),
    })),
  }));
}
