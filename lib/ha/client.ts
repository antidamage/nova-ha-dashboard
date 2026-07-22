import { setMaxListeners } from "node:events";
import WebSocket from "ws";
import type { HaState } from "../types";

// A single "all lights" / zone command fans out to one lane per entity, and every
// lane attaches (and later removes) an abort listener to the *same* request
// signal. For a home with many lights that legitimately exceeds Node's default
// EventTarget cap of 10, producing a spurious MaxListenersExceededWarning even
// though every listener is cleaned up on drain/supersede (see
// enqueueLatestServiceCall). Declare the higher ceiling once per signal.
const LATEST_LANE_MAX_ABORT_LISTENERS = 256;
const signalsWithRaisedListenerCap = new WeakSet<AbortSignal>();

function ensureSignalListenerHeadroom(signal: AbortSignal) {
  if (signalsWithRaisedListenerCap.has(signal)) {
    return;
  }
  signalsWithRaisedListenerCap.add(signal);
  try {
    setMaxListeners(LATEST_LANE_MAX_ABORT_LISTENERS, signal);
  } catch {
    // Non-Node signal (e.g. a plain EventTarget in a test) — best-effort only.
  }
}

const HA_URL = process.env.HA_URL ?? "http://127.0.0.1:8123";
const HA_TOKEN = process.env.HA_TOKEN;

export type CallServiceOptions = {
  latestKey?: string;
  signal?: AbortSignal;
};

type PendingServiceCall = {
  cleanup: () => void;
  domain: string;
  reject: (error: unknown) => void;
  resolve: (value: HaState[]) => void;
  service: string;
  serviceData: Record<string, unknown>;
  signal?: AbortSignal;
};

type LatestServiceLane = {
  active: boolean;
  drainQueued: boolean;
  pending: PendingServiceCall | null;
};

const latestServiceLanes = new Map<string, LatestServiceLane>();

function authHeaders() {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  return {
    Authorization: `Bearer ${HA_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function abortError(message = "Home Assistant service call aborted") {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

// A *hung* Home Assistant (accepts the socket but never answers) must fail fast,
// not stall the 5s state poller forever. Without this, one hung /api/states
// wedges `store.polling` and every /api/state request hangs with it. On timeout
// the poller throws and keeps the last snapshot; the mass-outage held-state path
// (lib/ha/health.ts) covers the "everything unavailable" case separately.
const HA_REST_TIMEOUT_MS = Number(process.env.HA_REST_TIMEOUT_MS ?? 8000);

export async function haRest<T>(path: string, init?: RequestInit): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), HA_REST_TIMEOUT_MS);
  // Compose the timeout with any caller-supplied signal so either can cancel.
  const callerSignal = init?.signal ?? undefined;
  const onCallerAbort = () => timeoutController.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      timeoutController.abort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${HA_URL}${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Home Assistant ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (timeoutController.signal.aborted && !callerSignal?.aborted) {
      throw new Error(`Home Assistant request timed out after ${HA_REST_TIMEOUT_MS}ms: ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

async function callServiceNow(
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
  options: CallServiceOptions = {},
) {
  const startedAt = Date.now();
  const shouldLog = domain === "climate";

  if (shouldLog) {
    console.info("[nova-dashboard] HA climate service call", { domain, service, serviceData });
  }

  try {
    const result = await haRest<HaState[]>(`/api/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(serviceData),
      signal: options.signal,
    });

    if (shouldLog) {
      console.info("[nova-dashboard] HA climate service success", {
        domain,
        durationMs: Date.now() - startedAt,
        result: result.map((state) => ({
          attributes: state.attributes,
          entity_id: state.entity_id,
          state: state.state,
        })),
        service,
        serviceData,
      });
    }

    return result;
  } catch (error) {
    if (shouldLog) {
      console.error("[nova-dashboard] HA climate service failed", {
        domain,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        service,
        serviceData,
      });
    }

    throw error;
  }
}

function queueLatestLaneDrain(key: string, lane: LatestServiceLane) {
  if (lane.drainQueued) {
    return;
  }

  lane.drainQueued = true;
  queueMicrotask(() => {
    lane.drainQueued = false;
    void drainLatestServiceLane(key, lane);
  });
}

async function drainLatestServiceLane(key: string, lane: LatestServiceLane) {
  if (lane.active || !lane.pending) {
    return;
  }

  const request = lane.pending;
  lane.pending = null;

  if (request.signal?.aborted) {
    request.cleanup();
    request.reject(abortError("Lighting command superseded"));
    if (!lane.pending) {
      latestServiceLanes.delete(key);
    }
    return;
  }

  lane.active = true;
  try {
    request.resolve(await callServiceNow(request.domain, request.service, request.serviceData, {
      signal: request.signal,
    }));
  } catch (error) {
    request.reject(error);
  } finally {
    request.cleanup();
    lane.active = false;
    if (lane.pending) {
      queueLatestLaneDrain(key, lane);
    } else {
      latestServiceLanes.delete(key);
    }
  }
}

function enqueueLatestServiceCall(
  key: string,
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return new Promise<HaState[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError("Lighting command superseded"));
      return;
    }

    let lane = latestServiceLanes.get(key);
    if (!lane) {
      lane = { active: false, drainQueued: false, pending: null };
      latestServiceLanes.set(key, lane);
    }

    const previousPending = lane.pending;
    if (previousPending) {
      previousPending.cleanup();
      previousPending.resolve([]);
    }

    const request: PendingServiceCall = {
      cleanup: () => undefined,
      domain,
      reject,
      resolve,
      service,
      serviceData,
      signal,
    };

    if (signal) {
      ensureSignalListenerHeadroom(signal);
      const abort = () => {
        if (lane?.pending === request) {
          lane.pending = null;
          request.cleanup();
          reject(abortError("Lighting command superseded"));
          if (!lane.active) {
            latestServiceLanes.delete(key);
          }
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      request.cleanup = () => signal.removeEventListener("abort", abort);
    }

    lane.pending = request;
    queueLatestLaneDrain(key, lane);
  });
}

export async function callService(
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
  options: CallServiceOptions = {},
) {
  if (options.latestKey) {
    return enqueueLatestServiceCall(options.latestKey, domain, service, serviceData, options.signal);
  }

  return callServiceNow(domain, service, serviceData, options);
}

export async function callServiceWithResponse<T>(
  domain: string,
  service: string,
  serviceData: Record<string, unknown>,
) {
  return haRest<T>(`/api/services/${domain}/${service}?return_response`, {
    method: "POST",
    body: JSON.stringify(serviceData),
  });
}

export function resetLatestServiceLanesForTest() {
  latestServiceLanes.clear();
}

export async function haWs<T>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  const wsUrl = `${HA_URL.replace(/^http/i, "ws")}/api/websocket`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 10000);

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
        return;
      }

      if (message.type === "auth_invalid") {
        clearTimeout(timer);
        ws.close();
        reject(new Error("Home Assistant WebSocket auth failed"));
        return;
      }

      if (message.type === "auth_ok") {
        ws.send(JSON.stringify({ id, type, ...payload }));
        return;
      }

      if (message.id === id) {
        clearTimeout(timer);
        ws.close();
        if (message.success) {
          resolve(message.result as T);
        } else {
          reject(new Error(message.error?.message ?? `Home Assistant ${type} failed`));
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export type HaStateChangeEvent = {
  contextId?: string;
  entityId: string;
  oldState?: HaState | null;
  newState?: HaState | null;
};

export function subscribeHaStateChanges(
  onChange: (entityId: string, change: HaStateChangeEvent) => void,
  onError?: (error: Error) => void,
) {
  if (!HA_TOKEN) {
    throw new Error("HA_TOKEN is not configured");
  }

  const wsUrl = `${HA_URL.replace(/^http/i, "ws")}/api/websocket`;
  const ws = new WebSocket(wsUrl);
  const subscriptionId = 1;
  let closed = false;
  let notified = false;

  // Fire onError at most once per subscription so the caller's reconnect logic
  // schedules exactly one retry, whether the failure arrives as an error, an
  // auth/subscription rejection, or a plain socket close (HA restart).
  const notifyError = (error: Error) => {
    if (notified || closed) {
      return;
    }
    notified = true;
    onError?.(error);
  };

  ws.on("message", (data) => {
    let message: {
      event?: {
        context?: { id?: unknown };
        data?: {
          entity_id?: unknown;
          old_state?: HaState | null;
          new_state?: HaState | null;
        };
      };
      id?: number;
      success?: boolean;
      type?: string;
      error?: { message?: string };
    };

    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (message.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
      return;
    }

    if (message.type === "auth_invalid") {
      notifyError(new Error("Home Assistant WebSocket auth failed"));
      ws.close();
      return;
    }

    if (message.type === "auth_ok") {
      ws.send(JSON.stringify({ id: subscriptionId, type: "subscribe_events", event_type: "state_changed" }));
      return;
    }

    if (message.id === subscriptionId && message.type === "result" && message.success === false) {
      notifyError(new Error(message.error?.message ?? "Home Assistant state_changed subscription failed"));
      ws.close();
      return;
    }

    if (message.type === "event") {
      const entityId = message.event?.data?.entity_id;
      if (typeof entityId === "string") {
        const contextId = message.event?.context?.id;
        onChange(entityId, {
          entityId,
          ...(typeof contextId === "string" ? { contextId } : {}),
          oldState: message.event?.data?.old_state,
          newState: message.event?.data?.new_state,
        });
      }
    }
  });

  ws.on("error", (error) => {
    notifyError(error instanceof Error ? error : new Error(String(error)));
  });

  // A plain close (e.g. Home Assistant restarting) must also trigger the
  // caller's reconnect — otherwise push updates silently stop until the whole
  // process restarts.
  ws.on("close", () => {
    notifyError(new Error("Home Assistant WebSocket closed"));
  });

  return () => {
    if (closed) {
      return;
    }
    closed = true;
    ws.close();
  };
}
