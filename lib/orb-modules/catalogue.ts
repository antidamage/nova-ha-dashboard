import type { OrbModule } from "./layer-types";
import { isValidOrbModuleId } from "./value-model";
import { CLASSIC_MODULE } from "./classic.data";
import { REACTOR_MODULE } from "./reactor.data";
import { HALO_MODULE } from "./halo.data";
import { CROSS_MODULE } from "./cross.data";
import { TECH_MODULE } from "./tech.data";

// ---------------------------------------------------------------------------
// Built-in modules
// ---------------------------------------------------------------------------
//
// Built-ins are compiled into both apps so the orb renders before (or
// without) a successful `/api/orb-modules` fetch. The server route merges
// these with any JSON files found in `config/orb-modules/`; a disk file with
// the same id REPLACES the built-in, which is how a deployed host can patch a
// built-in look without an app release.


/** Built-in modules, in the order the config picker should list them. */
export const BUILTIN_ORB_MODULES: OrbModule[] = [
  CLASSIC_MODULE,
  REACTOR_MODULE,
  HALO_MODULE,
  CROSS_MODULE,
  TECH_MODULE,
];

/** Lookup map for the built-ins. */
export const BUILTIN_ORB_MODULE_MAP: ReadonlyMap<string, OrbModule> = new Map(
  BUILTIN_ORB_MODULES.map((module) => [module.id, module]),
);

/**
 * Resolve a module id against an id->module map, falling back to the classic
 * built-in. This is the single fallback rule both platforms implement: a
 * theme can never reference its way into a blank orb.
 */
export function resolveOrbModule(
  id: unknown,
  modules?: ReadonlyMap<string, OrbModule> | null,
): OrbModule {
  if (isValidOrbModuleId(id)) {
    const fromMap = modules?.get(id);
    if (fromMap) return fromMap;
    const builtin = BUILTIN_ORB_MODULE_MAP.get(id);
    if (builtin) return builtin;
  }
  return CLASSIC_MODULE;
}
