import type { OrbModuleOutput, OrbStackEntry } from "./types";

/** Outputs are indexed by entry ID, so duplicate modules can use different params. */
export function resolveActiveEntry(
  entries: readonly OrbStackEntry[],
  outputs: Readonly<Record<string, OrbModuleOutput | undefined>>,
): { entry: OrbStackEntry; output: OrbModuleOutput } | null {
  for (const entry of entries) {
    const output = outputs[entry.id];
    if (!output || output.active === false) continue;
    if (output.active === undefined && entry.activation === "whenAlerting" && !output.alert) continue;
    return { entry, output };
  }
  return null;
}
