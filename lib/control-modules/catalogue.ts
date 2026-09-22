import { CONTROL_MODULES } from "./modules";
import type { ControlModule, ControlRendererId } from "./types";

/**
 * Lookups over the shipped module catalogue (specs/control-modules.md).
 *
 * Every lookup takes the registry it should read, rather than reaching for a
 * module-level one. The server's registry is built-ins plus installed packages,
 * and the client receives the same list with the dashboard state, so a lookup
 * that decided for itself would be reading a different world on each side.
 */

/**
 * The ids this build ships. An installed package may not claim one of these —
 * an upload that shadowed a shipped device type would change what every existing
 * preset means, silently.
 */
export function builtInModuleIds(): Set<string> {
  return new Set(CONTROL_MODULES.map((module) => module.id));
}

/**
 * Every lookup takes the registry it should read, rather than reaching for a
 * module-level one. The server's registry is built-ins plus installed packages
 * and the client receives the same list with the dashboard state, so a lookup
 * that decided for itself would be reading a different world on each side.
 */
export function controlModuleIn(modules: readonly ControlModule[], id: string): ControlModule | null {
  return modules.find((module) => module.id === id) ?? null;
}

export function controlModulesIn(modules: readonly ControlModule[], layer?: "control" | "driver"): ControlModule[] {
  return modules.filter((module) => (layer ? module.layer === layer : true));
}

/** The driver modules that plug into a control renderer and variant. */
export function driverModulesFor(
  modules: readonly ControlModule[],
  renderer: ControlRendererId,
  variant: string | null,
): ControlModule[] {
  return modules.filter(
    (module) =>
      module.layer === "driver" &&
      module.driverFor?.renderer === renderer &&
      module.driverFor.variant === variant,
  );
}

/** The driver a new preset gets when its variant is chosen — the first that plugs in. */
export function defaultDriverFor(
  modules: readonly ControlModule[],
  renderer: ControlRendererId,
  variant: string | null,
): ControlModule | null {
  return driverModulesFor(modules, renderer, variant)[0] ?? null;
}

// The module list is the data (`modules.ts`) and the features are gates
// (`features.ts`); both are re-exported here so call sites stay put.
export { CONTROL_MODULES } from "./modules";

// The feature gates live in `features.ts`: one implementation, shared by the
// editor that greys a row out and the model that drops its value.
export { featureApplies, resolveFeatures, type FeatureSubject } from "./features";
