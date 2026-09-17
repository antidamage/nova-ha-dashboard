// Module server-half loader — facade. The body lives in
// lib/modules/runtime/loader/; this file keeps the import path stable for its
// callers (specs/agent-token-footprint.md §3.3).
//
// Where things are:
//
//   loader/types.ts        ModuleRouteHandler, LoadedModule, LoaderStore
//   loader/store.ts        SOLE owner of the globalThis-held loaded-module map
//   loader/server-api.ts   the api object handed to register(api), routeKey
//   loader/lifecycle.ts    load/unload/reload, startModuleRuntime and the
//                          loaded-module queries

export type { ModuleRouteHandler } from "./loader/types";

export {
  unloadModule,
  reloadModule,
  startModuleRuntime,
  notifyModuleConfigChanged,
  moduleStatusReports,
  findModuleRoute,
  isModuleLoaded,
} from "./loader/lifecycle";
