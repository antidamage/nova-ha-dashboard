/**
 * Phonoscope configuration and installed-module store — facade. The body lives
 * in lib/phonoscope-store/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3). Server-only: store.ts uses fs.
 *
 *   phonoscope-store/types.ts          PhonoscopeConfig, the stored manifest
 *   phonoscope-store/constants.ts      default config and colours, driver/effect vocabulary
 *   phonoscope-store/color-model.ts    value helpers, colour normalisation, colour themes
 *   phonoscope-store/lanes-model.ts    drivers, bindings, lanes, settings groups
 *   phonoscope-store/groups-model.ts   colour groups, House Party, the default group
 *   phonoscope-store/package-model.ts  package names, hashing, built-in module, archive paths
 *   phonoscope-store/read-config.ts    readPhonoscopeConfig and its v3-v6 migrations
 *   phonoscope-store/write-config.ts   writePhonoscopeConfig
 *   phonoscope-store/store.ts          SOLE owner of disk state: the installed module tree
 */
export type { PhonoscopeConfig } from "./phonoscope-store/types";
export { DEFAULT_PHONOSCOPE_CONFIG } from "./phonoscope-store/constants";
export { normalizePhonoscopeColorThemes } from "./phonoscope-store/color-model";
export { normalizePhonoscopeSettingsGroups, prunePhonoscopeLanes } from "./phonoscope-store/lanes-model";
export { normalizePhonoscopeColorGroups } from "./phonoscope-store/groups-model";
export { readPhonoscopeConfig } from "./phonoscope-store/read-config";
export { writePhonoscopeConfig } from "./phonoscope-store/write-config";
export {
  installPhonoscopePackage,
  listPhonoscopeModules,
  readPhonoscopeAsset,
  readPhonoscopeCompiledModule,
  readPhonoscopeSource,
  removePhonoscopeModule,
} from "./phonoscope-store/store";
