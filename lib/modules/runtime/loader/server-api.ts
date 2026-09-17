// The api object handed to a module's register(api), and the route-key/origin
// helpers it depends on.

import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { readModuleSecret } from "../../../dashboard-secrets";
import {
  emitModuleEvent,
  registerEventHandler,
  registerInterceptHandler,
  type EventHandler,
  type InterceptHandler,
} from "../hooks";
import { moduleDir } from "../store";
import { renderTemplate } from "../template";
import { isEventId, isInterceptId, isSlotId, type EventId, type InterceptId, type ModuleEvent, type ModuleStatusReport } from "../types";
import type { LoadedModule, ModuleRouteHandler } from "./types";

export function routeKey(method: string, segments: string[]) {
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

export function buildServerApi(entry: LoadedModule, config: Record<string, unknown>) {
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
