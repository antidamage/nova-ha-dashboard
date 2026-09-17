// Sole owner of the loader's globalThis-held state
// (specs/agent-token-footprint.md §4.2).

import type { LoaderStore } from "./types";

const GLOBAL_KEY = "__novaModuleLoader";

export function store(): LoaderStore {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: LoaderStore };
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = { loaded: new Map(), starting: null };
  }
  return holder[GLOBAL_KEY];
}
