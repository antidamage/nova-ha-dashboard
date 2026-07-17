// Server-side loader for hot-droppable status orb module files.
//
// Each `*.json` file in the module directory holds one module document (see
// lib/orb-modules.ts for the format). Dropping a new file in — or editing an
// existing one — publishes a new orb look to every connected web and Apple TV
// client on their next `/api/orb-modules` fetch, without an app update. The
// env override lets deployments relocate the directory outside the app tree.

import { readdir, readFile } from "fs/promises";
import path from "path";
import { normalizeOrbModule, type OrbModule } from "./orb-modules";

const ORB_MODULE_DIR =
  process.env.NOVA_ORB_MODULES_DIR ?? path.join(process.cwd(), "config", "orb-modules");

export type OrbModuleFileError = { file: string; error: string };

export type OrbModuleDiskResult = {
  modules: OrbModule[];
  errors: OrbModuleFileError[];
};

/**
 * Read and normalize every module file on disk. Invalid files are reported,
 * not fatal: one bad JSON drop must never take down the whole module list.
 * A missing directory simply means "no extra modules installed".
 */
export async function readDiskOrbModules(dir = ORB_MODULE_DIR): Promise<OrbModuleDiskResult> {
  const modules: OrbModule[] = [];
  const errors: OrbModuleFileError[] = [];

  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { modules, errors };
    }
    throw error;
  }

  for (const entry of entries.filter((name) => name.toLowerCase().endsWith(".json")).sort()) {
    try {
      const parsed = JSON.parse(await readFile(path.join(dir, entry), "utf8"));
      const normalized = normalizeOrbModule(parsed);
      if (!normalized) {
        errors.push({
          file: entry,
          error: "Invalid orb module document (bad id, version, or no usable layers)",
        });
        continue;
      }
      modules.push(normalized);
    } catch (error) {
      errors.push({
        file: entry,
        error: error instanceof Error ? error.message : "Unreadable module file",
      });
    }
  }

  return { modules, errors };
}
