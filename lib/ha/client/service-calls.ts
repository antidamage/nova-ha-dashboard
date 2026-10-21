import { setMaxListeners } from "node:events";
import type { HaState } from "../../types";
import { haRest } from "./connection";

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

function abortError(message = "Home Assistant service call aborted") {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }

  const error = new Error(message);
  error.name = "AbortError";
  return error;
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
