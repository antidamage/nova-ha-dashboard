// Load and unload module server halves (`specs/module-system.md` §2).
//
// The load is a plain dynamic import of a file on disk. `webpackIgnore` keeps
// Turbopack from trying to resolve the specifier at build time, and the
// `?v=<mtime>` query is the reload mechanism — ESM caches by resolved URL and
// offers no uncache, so a reload has to import under a new URL. That leaks the
// previous module graph, which is accepted: reloads are a recovery action, not
// a hot path.

import path from "path";
import { pathToFileURL } from "url";
import { stat } from "fs/promises";
import { clearModuleHooks } from "../hooks";
import { manifestEntries } from "../manifest";
import {
  coerceModuleConfig,
  listInstalledIds,
  moduleDir,
  patchInstalledRecord,
  readInstalledRecords,
  readManifest,
  readModuleConfig,
} from "../store";
import type { ModuleStatusReport } from "../types";
import { buildServerApi, routeKey } from "./server-api";
import { store } from "./store";
import type { LoadedModule } from "./types";

const DISPOSE_TIMEOUT_MS = 5_000;

async function disposeLoaded(entry: LoadedModule) {
  clearModuleHooks(entry.id);
  entry.routes.clear();
  entry.configListeners.length = 0;
  const dispose = entry.instance?.dispose;
  if (typeof dispose !== "function") {
    return;
  }
  let settled = false;
  await Promise.race([
    Promise.resolve()
      .then(() => dispose.call(entry.instance))
      .then(() => {
        settled = true;
      })
      .catch((error) => {
        settled = true;
        console.error(`[nova-modules] ${entry.id} dispose threw`, error);
      }),
    new Promise<void>((resolve) => setTimeout(resolve, DISPOSE_TIMEOUT_MS)),
  ]);
  if (!settled) {
    console.error(`[nova-modules] ${entry.id} dispose did not finish in ${DISPOSE_TIMEOUT_MS}ms`);
  }
}

async function loadOne(id: string): Promise<void> {
  const manifest = await readManifest(id);
  if (!manifest) {
    await patchInstalledRecord(id, { state: "failed", error: "module.json is missing or invalid" });
    return;
  }

  const entryFile = path.join(moduleDir(id), manifestEntries(manifest).server);
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(entryFile)).mtimeMs;
  } catch {
    // Client-only modules are legitimate — nothing to load on this side.
    await patchInstalledRecord(id, { state: "loaded", error: undefined });
    return;
  }

  const entry: LoadedModule = {
    id,
    manifest,
    instance: null,
    routes: new Map(),
    configListeners: [],
  };

  try {
    const url = `${pathToFileURL(entryFile).href}?v=${Math.trunc(mtimeMs)}`;
    const loaded = (await import(/* webpackIgnore: true */ url)) as {
      default?: { register?: (api: unknown) => unknown; dispose?: () => unknown };
    };
    const instance = loaded.default;
    if (!instance || typeof instance.register !== "function") {
      throw new Error("default export must be an object with a register(api) function");
    }
    entry.instance = instance;
    store().loaded.set(id, entry);

    const config = coerceModuleConfig(manifest, await readModuleConfig(id));
    await instance.register(buildServerApi(entry, config));
    await patchInstalledRecord(id, { state: "loaded", error: undefined });
  } catch (error) {
    clearModuleHooks(id);
    store().loaded.delete(id);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[nova-modules] ${id} failed to load`, error);
    await patchInstalledRecord(id, { state: "failed", error: message });
  }
}

export async function unloadModule(id: string) {
  const entry = store().loaded.get(id);
  if (entry) {
    await disposeLoaded(entry);
    store().loaded.delete(id);
  } else {
    clearModuleHooks(id);
  }
}

export async function reloadModule(id: string) {
  await unloadModule(id);
  const records = await readInstalledRecords();
  if (records[id]?.enabled === false) {
    await patchInstalledRecord(id, { state: "disabled", error: undefined });
    return;
  }
  await loadOne(id);
}

/** Load every enabled module. Safe to call more than once. */
export async function startModuleRuntime(): Promise<void> {
  const current = store().starting;
  if (current) {
    return current;
  }
  const work = (async () => {
    const [ids, records] = await Promise.all([listInstalledIds(), readInstalledRecords()]);
    for (const id of ids) {
      if (records[id]?.enabled === false) {
        await patchInstalledRecord(id, { state: "disabled", error: undefined });
        continue;
      }
      await loadOne(id);
    }
  })();
  store().starting = work;
  try {
    await work;
  } finally {
    store().starting = null;
  }
}

/** Tell a loaded module its config changed, without a full reload. */
export function notifyModuleConfigChanged(id: string, config: Record<string, unknown>) {
  const entry = store().loaded.get(id);
  if (!entry) {
    return;
  }
  for (const listener of entry.configListeners) {
    try {
      listener(config);
    } catch (error) {
      console.error(`[nova-modules] ${id} config listener threw`, error);
    }
  }
}

export function moduleStatusReports(): Map<string, ModuleStatusReport | undefined> {
  const out = new Map<string, ModuleStatusReport | undefined>();
  for (const [id, entry] of store().loaded) {
    out.set(id, entry.status);
  }
  return out;
}

export function findModuleRoute(id: string, method: string, segments: string[]) {
  return store().loaded.get(id)?.routes.get(routeKey(method, segments));
}

export function isModuleLoaded(id: string) {
  return store().loaded.has(id);
}
