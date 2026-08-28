import path from "path";
import { pathToFileURL } from "url";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { readModuleSecret } from "../../dashboard-secrets";
import { manifestEntries, type ModuleManifest } from "./manifest";
import {
  clearModuleHooks,
  emitModuleEvent,
  registerEventHandler,
  registerInterceptHandler,
  type EventHandler,
  type InterceptHandler,
} from "./hooks";
import {
  coerceModuleConfig,
  listInstalledIds,
  moduleDir,
  patchInstalledRecord,
  readInstalledRecords,
  readManifest,
  readModuleConfig,
} from "./store";
import { renderTemplate } from "./template";
import { isEventId, isInterceptId, isSlotId, type EventId, type InterceptId, type ModuleEvent, type ModuleStatusReport } from "./types";

/**
 * Loads and unloads module server halves (`specs/module-system.md` §2).
 *
 * The load is a plain dynamic import of a file on disk. `webpackIgnore` keeps
 * Turbopack from trying to resolve the specifier at build time, and the
 * `?v=<mtime>` query is the reload mechanism — ESM caches by resolved URL and
 * offers no uncache, so a reload has to import under a new URL. That leaks the
 * previous module graph, which is accepted: reloads are a recovery action, not
 * a hot path.
 */

export type ModuleRouteHandler = (request: {
  method: string;
  pathSegments: string[];
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}) => Promise<{ status?: number; body?: unknown }> | { status?: number; body?: unknown };

type LoadedModule = {
  id: string;
  manifest: ModuleManifest;
  instance: { register?: (api: unknown) => unknown; dispose?: () => unknown } | null;
  routes: Map<string, ModuleRouteHandler>;
  status?: ModuleStatusReport;
  configListeners: ((config: Record<string, unknown>) => void)[];
};

type LoaderStore = {
  loaded: Map<string, LoadedModule>;
  starting: Promise<void> | null;
};

const GLOBAL_KEY = "__novaModuleLoader";

function store(): LoaderStore {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: LoaderStore };
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = { loaded: new Map(), starting: null };
  }
  return holder[GLOBAL_KEY];
}

const DISPOSE_TIMEOUT_MS = 5_000;

function routeKey(method: string, segments: string[]) {
  return `${method.toUpperCase()} /${segments.join("/")}`;
}

/**
 * Where this dashboard answers its own API.
 *
 * Modules run inside this process but still have to speak HTTP to reach a route
 * handler, and asking each one to configure a base URL just moves a fact the
 * server already knows into a field someone has to get right. `next start`
 * honours PORT and defaults to 3000, which is the same rule this follows.
 */
function dashboardOrigin() {
  const port = Number(process.env.PORT);
  return `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 3000}`;
}

function buildServerApi(entry: LoadedModule, config: Record<string, unknown>) {
  const { id, manifest } = entry;
  return {
    id,
    version: manifest.version,
    config,
    messages: manifest.messages,
    dashboardBaseUrl: dashboardOrigin(),

    /** Call this dashboard's own API. Path only — the origin is not a module's business. */
    async novaFetch(routePath: string, init?: RequestInit) {
      const suffix = routePath.startsWith("/") ? routePath : `/${routePath}`;
      return fetch(`${dashboardOrigin()}${suffix}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    },

    onConfigChange(listener: (next: Record<string, unknown>) => void) {
      entry.configListeners.push(listener);
    },

    on(hookId: string, handler: EventHandler) {
      if (!isEventId(hookId)) {
        throw new Error(`${id}: "${hookId}" is not an event id`);
      }
      if (!manifest.hooks.includes(hookId)) {
        throw new Error(`${id}: event "${hookId}" is not declared in module.json hooks`);
      }
      registerEventHandler(id, hookId as EventId, handler);
    },

    intercept(hookId: string, handler: InterceptHandler) {
      if (!isInterceptId(hookId)) {
        throw new Error(`${id}: "${hookId}" is not an intercept id`);
      }
      if (!manifest.hooks.includes(hookId)) {
        throw new Error(`${id}: intercept "${hookId}" is not declared in module.json hooks`);
      }
      registerInterceptHandler(id, hookId as InterceptId, handler);
    },

    // Present so a module can fail loudly rather than silently doing nothing if
    // it tries to register UI from the wrong half.
    slot(hookId: string) {
      if (isSlotId(hookId)) {
        throw new Error(`${id}: slot "${hookId}" must be registered from the client half`);
      }
      throw new Error(`${id}: "${hookId}" is not a slot id`);
    },

    route(method: string, routePath: string, handler: ModuleRouteHandler) {
      if (!manifest.routes) {
        throw new Error(`${id}: module.json must set "routes": true to serve routes`);
      }
      const segments = routePath.split("/").filter(Boolean);
      entry.routes.set(routeKey(method, segments), handler);
    },

    emit(event: Omit<ModuleEvent, "source"> & { source?: ModuleEvent["source"] }) {
      emitModuleEvent({ ...event, source: event.source ?? "server" } as ModuleEvent);
    },

    secret(name: string) {
      if (!manifest.secrets.includes(name)) {
        throw new Error(`${id}: secret "${name}" is not declared in module.json`);
      }
      return readModuleSecret(name);
    },

    render(template: string, event: ModuleEvent) {
      return renderTemplate(template, event);
    },

    setStatus(status: ModuleStatusReport) {
      entry.status = status;
    },

    storage: {
      async read(name: string): Promise<unknown> {
        assertStorageName(name);
        try {
          return JSON.parse(await readFile(path.join(moduleDir(id), "storage", name), "utf8")) as unknown;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return undefined;
          }
          throw error;
        }
      },
      async write(name: string, value: unknown) {
        assertStorageName(name);
        const dir = path.join(moduleDir(id), "storage");
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, name), `${JSON.stringify(value)}\n`, "utf8");
      },
    },

    log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) {
      const line = `[module:${id}] ${message}`;
      if (level === "error") {
        console.error(line, data ?? "");
      } else if (level === "warn") {
        console.warn(line, data ?? "");
      } else {
        console.log(line, data ?? "");
      }
    },
  };
}

function assertStorageName(name: string) {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\.json$/i.test(name)) {
    throw new Error(`Invalid module storage file name "${name}"`);
  }
}

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
