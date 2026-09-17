/**
 * Phonoscope config panel maths. Split out of `PhonoscopeConfig.tsx`
 * (specs/agent-token-footprint.md §4).
 */
import type { ModuleSummary } from "./types";

export function moduleKey(module: Pick<ModuleSummary, "id" | "version">) {
  return `${module.id}@${module.version}`;
}
