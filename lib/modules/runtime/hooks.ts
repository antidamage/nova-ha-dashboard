import type {
  EventId,
  InterceptContext,
  InterceptDecision,
  InterceptId,
  ModuleEvent,
} from "./types";

/**
 * The server-side hook bus (`specs/module-system.md` §3).
 *
 * Registrations are held per module so a reload can drop one module's hooks
 * without disturbing anyone else's. The store hangs off `globalThis` for the
 * same reason `lib/dashboard-events.ts` does: Turbopack can instantiate a module
 * more than once, and a second empty registry would silently drop every hook.
 */

export type EventHandler = (event: ModuleEvent) => void | Promise<void>;
export type InterceptHandler = (
  context: InterceptContext,
) => InterceptDecision | Promise<InterceptDecision>;

type Registration<T> = { moduleId: string; handler: T };

type HookStore = {
  events: Map<EventId, Registration<EventHandler>[]>;
  intercepts: Map<InterceptId, Registration<InterceptHandler>[]>;
};

const GLOBAL_KEY = "__novaModuleHooks";

function store(): HookStore {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: HookStore };
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = { events: new Map(), intercepts: new Map() };
  }
  return holder[GLOBAL_KEY];
}

/** An interceptor that has not settled in this long is treated as "proceed". */
export const INTERCEPT_TIMEOUT_MS = 5_000;

export function registerEventHandler(moduleId: string, id: EventId, handler: EventHandler) {
  const list = store().events.get(id) ?? [];
  list.push({ moduleId, handler });
  store().events.set(id, list);
}

export function registerInterceptHandler(
  moduleId: string,
  id: InterceptId,
  handler: InterceptHandler,
) {
  const list = store().intercepts.get(id) ?? [];
  list.push({ moduleId, handler });
  store().intercepts.set(id, list);
}

/** Drop every hook a module registered. Called before reload and on disable. */
export function clearModuleHooks(moduleId: string) {
  const { events, intercepts } = store();
  for (const [id, list] of events) {
    events.set(id, list.filter((entry) => entry.moduleId !== moduleId));
  }
  for (const [id, list] of intercepts) {
    intercepts.set(id, list.filter((entry) => entry.moduleId !== moduleId));
  }
}

export function hasEventHandlers(id: EventId) {
  return (store().events.get(id)?.length ?? 0) > 0;
}

export function hasInterceptHandlers(id: InterceptId) {
  return (store().intercepts.get(id)?.length ?? 0) > 0;
}

/**
 * Publish an event. Never throws and never blocks the caller — an emitter sits
 * on the response path of a control action, and a slow module must not be able
 * to make a light feel sluggish.
 */
export function emitModuleEvent(event: ModuleEvent) {
  const list = store().events.get(event.id);
  if (!list?.length) {
    return;
  }
  for (const { moduleId, handler } of list) {
    void (async () => {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[nova-modules] ${moduleId} failed handling ${event.id}`, error);
      }
    })();
  }
}

export type InterceptOutcome =
  | { decision: "proceed" }
  | { decision: "cancel"; moduleId: string };

function withTimeout(
  work: Promise<InterceptDecision>,
  moduleId: string,
  id: InterceptId,
): Promise<InterceptDecision> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`[nova-modules] ${moduleId} intercept ${id} timed out; proceeding`);
      resolve("proceed");
    }, INTERCEPT_TIMEOUT_MS);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        console.error(`[nova-modules] ${moduleId} intercept ${id} threw; proceeding`, error);
        resolve("proceed");
      },
    );
  });
}

/**
 * Run every registered interceptor in registration order. The first `cancel`
 * wins and the rest are not consulted.
 *
 * A `{ confirm }` result is **client-only** — there is no user to ask on the
 * server, and proceeding anyway would defeat the point of asking. Here it fails
 * closed, as a cancel, with a log saying so. A module that wants a confirmation
 * step registers the interceptor on its client half.
 */
export async function runModuleIntercepts(context: InterceptContext): Promise<InterceptOutcome> {
  const list = store().intercepts.get(context.id);
  if (!list?.length) {
    return { decision: "proceed" };
  }
  for (const { moduleId, handler } of [...list]) {
    const decision = await withTimeout(
      Promise.resolve().then(() => handler(context)),
      moduleId,
      context.id,
    );
    if (decision === "proceed") {
      continue;
    }
    if (decision === "cancel") {
      return { decision: "cancel", moduleId };
    }
    console.error(
      `[nova-modules] ${moduleId} returned a confirm from a server intercept (${context.id}); ` +
        "confirmation is client-only, treating as cancel",
    );
    return { decision: "cancel", moduleId };
  }
  return { decision: "proceed" };
}
