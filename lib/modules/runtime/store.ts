// Installed-module disk state — facade. The body lives in
// lib/modules/runtime/store/; this file keeps the import path stable for its
// callers (specs/agent-token-footprint.md §3.3).
//
// On-disk state for installed modules (`specs/module-system.md` §9). These
// live under `data/` rather than `config/` on purpose: `data/` is excluded
// from `deploy-nova-dashboard.ps1`'s tar and is never replaced by
// `nova-release`'s release swap, so an installed module and its config survive
// both a deploy and a self-update.
//
// Where things are:
//
//   store/constants.ts   MODULES_DIR, INSTALL_LIMITS, allowed asset extensions
//   store/store.ts       SOLE state owner: write queue, JSON primitives,
//                        installed-record + manifest reads, moduleSummaries
//   store/config.ts      per-module config read/write, schema coercion
//   store/install.ts     install / uninstall / pack (zip handling)

export { MODULES_DIR, INSTALL_LIMITS } from "./store/constants";

export {
  moduleDir,
  readInstalledRecords,
  patchInstalledRecord,
  readManifest,
  listInstalledIds,
  clientVersionToken,
  moduleSummaries,
} from "./store/store";

export { readModuleConfig, writeModuleConfig, coerceModuleConfig, exportableModuleConfig } from "./store/config";

export type { InstallResult } from "./store/types";
export { installModulePackage, deleteModule, packModule } from "./store/install";
