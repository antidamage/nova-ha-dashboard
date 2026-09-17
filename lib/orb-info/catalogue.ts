/**
 * The status orb info module catalogue — lookup surface.
 *
 * The table itself is `catalogue.data.ts` (specs/agent-token-footprint.md §2
 * criterion 1, the over-30 KB escape hatch); this file is the small half that
 * indexes it, plus the import path every caller already uses (§3.3).
 *
 *   catalogue.data.ts  ORB_INFO_MODULES, ORB_INFO_MODULES_BY_ID — the table
 *                      and its id index, which the `gym-progress` module reads
 *                      back out of at call time
 *   types.ts           OrbInfoSources, OrbModule and the shared orb shapes
 */
import { ORB_INFO_MODULES_BY_ID } from "./catalogue.data";
import type { OrbModule, OrbModuleDefinition } from "./types";

export {
  GYM_SHOW_AFTER_HOURS,
  ORB_INFO_MODULES,
  ORB_INFO_MODULES_BY_ID,
} from "./catalogue.data";
export type { OrbInfoSources, OrbModule } from "./types";

export const DEFAULT_ORB_MODULE_ID = "gym";

export function orbModuleById(id: string | undefined): OrbModule {
  return ORB_INFO_MODULES_BY_ID[id ?? ""] ?? ORB_INFO_MODULES_BY_ID[DEFAULT_ORB_MODULE_ID];
}

export const ORB_MODULE_GROUP_LABELS: Record<OrbModuleDefinition["group"], string> = {
  none: "Off",
  cadence: "Cadence",
  host: "Host",
  time: "Time & Sky",
  climate: "Climate",
  power: "Power",
  household: "Household",
  system: "System",
};
