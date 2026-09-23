// Status Orb module format: per-frame resolution of module settings, layer
// gates and setting-bound layer parameters.

import type { OrbLayerGate, OrbModuleSettingDecl, OrbSettingValue } from "./types";
import { migrateOrbModuleSettings } from "./migration-model";
import type { OrbModule } from "./layer-types";
import { clamp } from "./value-model";

/**
 * The value a layer's gate tests for a choice setting's `"auto"` stop.
 *
 * `"auto"` names no treatment of its own — it defers to the device theme, so a
 * module gate cannot test it directly. Callers supply the treatment the device
 * resolves to (the knob's own light/dark skin, as `RotaryEncoder` reads it),
 * as the index of that option in the setting's `options`.
 */
export type OrbAutoOptionResolver = (setting: OrbModuleSettingDecl) => number | undefined;

/**
 * The id a choice setting's RESOLVED value is published under. Every choice
 * setting (`options` present) gets a companion entry in the resolved map, so a
 * layer's gate names one id and never has to know whether the user picked
 * `auto`: `{ setting: "knobThemeResolved", max: 0.5 }` is the dark stack.
 *
 * The published value is a TREATMENT FLAG, not the slider's index: 1 when the
 * resolved option is `light`, 0 when it is `dark`. That keeps a gate's meaning
 * independent of the order the options are listed in — the slider can show
 * Light, Auto, Dark while the layers still read one flag — and it is the same
 * 1 = light / 0 = dark sense the Tech module's gates were written in.
 */
export function orbResolvedSettingId(settingId: string) {
  return `${settingId}Resolved`;
}

/** The 1 = light / 0 = dark treatment flag a resolved choice publishes. */
export const ORB_LIGHT_TREATMENT = 1;
export const ORB_DARK_TREATMENT = 0;

/** The value a choice's option at `index` sits at. */
export function orbOptionValue(decl: OrbModuleSettingDecl, index: number) {
  return clamp(decl.min + index * decl.step, decl.min, decl.max);
}

/** The option index a choice's value selects; -1 when the value is unusable. */
export function orbOptionIndex(decl: OrbModuleSettingDecl, value: number) {
  const count = decl.options?.length ?? 0;
  if (count === 0 || !Number.isFinite(value)) return -1;
  const index = Math.round((value - decl.min) / decl.step);
  return index >= 0 && index < count ? index : -1;
}

/**
 * The value a choice setting resolves to for this frame: the stop the owner
 * pinned, or — when that is `auto` — the treatment the device reports. A
 * setting with no `options` is a magnitude and resolves to itself.
 *
 * An option INDEX is not a value: `min`/`step` need not be 0/1, so the
 * resolver's index is converted through orbOptionValue rather than used as a
 * number. Comparing the two kinds against each other is what let a stepped
 * choice land on the wrong stop.
 *
 * Stop names are matched case-insensitively: they are user-facing labels, so a
 * module is free to write "Auto" where this looks for "auto".
 */
export function resolveOrbChoiceValue(
  decl: OrbModuleSettingDecl,
  chosen: number,
  autoOption?: OrbAutoOptionResolver,
): number {
  const options = decl.options ?? [];
  if (options.length === 0) return chosen;
  const autoIndex = options.findIndex((option) => option.toLowerCase() === "auto");
  // `chosen` is a VALUE and `autoIndex` an INDEX: compare them as indices.
  if (autoIndex < 0 || orbOptionIndex(decl, chosen) !== autoIndex) return chosen;

  const answered = autoOption?.(decl);
  if (typeof answered === "number" && Number.isFinite(answered)) {
    const index = Math.round(answered);
    // A resolver that answers with the `auto` stop itself has not answered, so
    // fall through rather than leaving the gate a stop it cannot interpret.
    if (index >= 0 && index < options.length && index !== autoIndex) {
      return orbOptionValue(decl, index);
    }
  }
  return orbOptionValue(decl, concreteFallbackIndex(decl, options, autoIndex));
}

/**
 * The author's own answer for "no device theme to defer to": their declared
 * default when that names a concrete stop, else the first stop that does.
 *
 * Never `auto` itself, because answering `auto` with `auto` would leave the
 * gates reading a stop that means "ask the device".
 */
function concreteFallbackIndex(
  decl: OrbModuleSettingDecl,
  options: string[],
  autoIndex: number,
): number {
  const declared = orbOptionIndex(decl, decl.default);
  if (declared >= 0 && declared !== autoIndex) return declared;
  const first = options.findIndex((_, index) => index !== autoIndex);
  return first >= 0 ? first : 0;
}

/**
 * The light/dark treatment flag for a resolved choice: 1 when the option the
 * choice resolved to is `light`, 0 when it is `dark`. A setting that offers
 * neither — an ordinary choice, or a magnitude — publishes its own value, so
 * adding `options` to a magnitude setting never silently repaints a module.
 *
 * Matched case-insensitively, like `auto` above: the stop names are labels.
 */
export function resolveOrbChoiceTreatment(
  decl: OrbModuleSettingDecl,
  chosen: number,
  autoOption?: OrbAutoOptionResolver,
): number {
  const options = decl.options ?? [];
  if (options.length === 0) return chosen;
  const index = orbOptionIndex(decl, resolveOrbChoiceValue(decl, chosen, autoOption));
  const resolved = options[index]?.toLowerCase();
  if (resolved === "light") return ORB_LIGHT_TREATMENT;
  if (resolved === "dark") return ORB_DARK_TREATMENT;
  return resolveOrbChoiceValue(decl, chosen, autoOption);
}

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
 *
 * Each CHOICE setting (`options` present) also publishes its resolved value
 * under `<id>Resolved` — that is what its layers' gates test, so `auto`
 * becomes a concrete light or dark treatment without the gates knowing
 * `auto` exists. `autoOption` supplies that treatment; the config UI passes
 * the slider's chosen index through unchanged so the control still shows the
 * stop the user picked.
 *
 * The `<id>Resolved` suffix is RESERVED: derived ids are written after every
 * declared value, so a module that declares a setting literally named
 * `knobThemeResolved` cannot overwrite the flag its own gates depend on.
 */
export function resolveOrbModuleSettings(
  module: OrbModule,
  saved?: Record<string, number> | null,
  autoOption?: OrbAutoOptionResolver,
): Record<string, number> {
  const given = migrateOrbModuleSettings(module, saved);
  const settings = module.settings ?? [];
  const chosen: Record<string, number> = {};
  for (const decl of settings) {
    const raw = Number(given[decl.id]);
    chosen[decl.id] = Number.isFinite(raw) ? clamp(raw, decl.min, decl.max) : decl.default;
  }
  const resolved: Record<string, number> = { ...chosen };
  for (const decl of settings) {
    if (decl.options && decl.options.length > 0) {
      resolved[orbResolvedSettingId(decl.id)] = resolveOrbChoiceTreatment(decl, chosen[decl.id], autoOption);
    }
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
