// Dashboard state polling, HA health transitions, and the Home Assistant
// state-change subscription with its reconnect backoff.

import { emitDashboardEvent } from "../event-spool";
import { buildDashboardState, subscribeHaStateChanges } from "../ha";
import { appendHouseholdEvent, normalizedHaStateChange } from "../household-events";
import type { DashboardState, HaDomain } from "../types";
import {
  DASHBOARD_EVENT_PUSH_DEBOUNCE_MS,
  HA_WS_RECONNECT_MAX_MS,
  HA_WS_RECONNECT_MIN_MS,
} from "./constants";
import { publishDashboardError, publishDashboardState } from "./publish";
import { store } from "./store";

// Emit a bracketed event whenever the HA snapshot flips into or out of the
// held-state "degraded" mode (lib/ha/health.ts) so the soft-outage itself is
// visible and attributed in the monitoring stream, not just its side effects.
function reportHaHealthTransition(state: DashboardState) {
  const status = state.haHealth?.status ?? "ok";
  if (status === store.haHealthStatus) {
    return;
  }
  store.haHealthStatus = status;
  if (status === "degraded") {
    void emitDashboardEvent({
      service: "system",
      event: "ha-unavailable",
      source: "system",
      phase: "start",
      detail: { reason: state.haHealth?.reason, held: state.haHealth?.heldEntityCount },
    });
  } else {
    void emitDashboardEvent({ service: "system", event: "ha-unavailable", source: "system", phase: "end" });
  }
}

export async function pollDashboardState() {
  if (store.polling) {
    store.pollPending = true;
    return;
  }

  if (Date.now() < store.lightPollHoldUntil) {
    store.pollPending = true;
    return;
  }

  store.polling = true;
  store.pollPending = false;
  try {
    const state = await buildDashboardState();
    reportHaHealthTransition(state);
    publishDashboardState(state);
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to refresh dashboard state");
  } finally {
    store.polling = false;
    if (store.pollPending) {
      store.pollPending = false;
      setTimeout(() => {
        void pollDashboardState();
      }, DASHBOARD_EVENT_PUSH_DEBOUNCE_MS);
    }
  }
}

function dashboardDomainFromEntityId(entityId: string) {
  const [domain] = entityId.split(".", 1);
  return domain as HaDomain | undefined;
}

function entityMayAffectDashboard(entityId: string) {
  const domain = dashboardDomainFromEntityId(entityId);
  return domain === "light" || domain === "switch" || domain === "climate" || domain === "fan" || domain === "cover" || domain === "humidifier" || domain === "sensor" || domain === "sun" || domain === "weather";
}

function scheduleDashboardStatePoll() {
  if (store.haStateChangeTimer) {
    clearTimeout(store.haStateChangeTimer);
  }

  store.haStateChangeTimer = setTimeout(() => {
    store.haStateChangeTimer = null;
    void pollDashboardState();
  }, DASHBOARD_EVENT_PUSH_DEBOUNCE_MS);
}

function scheduleHaStateChangeReconnect() {
  if (store.haStateChangeReconnectTimer) {
    return;
  }
  // Capped exponential backoff so a bounced HA reconnects quickly but a hard-down
  // HA doesn't hot-loop the socket.
  const delay = Math.min(
    HA_WS_RECONNECT_MAX_MS,
    HA_WS_RECONNECT_MIN_MS * 2 ** store.haStateChangeReconnectAttempts,
  );
  store.haStateChangeReconnectAttempts += 1;
  store.haStateChangeReconnectTimer = setTimeout(() => {
    store.haStateChangeReconnectTimer = null;
    startHaStateChangeSubscription();
  }, delay);
}

export function startHaStateChangeSubscription() {
  if (store.haStateChangeUnsubscribe) {
    return;
  }

  try {
    store.haStateChangeUnsubscribe = subscribeHaStateChanges(
      (entityId, change) => {
        // Any successful event means the socket is healthy again — reset backoff.
        store.haStateChangeReconnectAttempts = 0;
        void appendHouseholdEvent(normalizedHaStateChange(change)).catch((error) => {
          console.error("[nova-dashboard] Failed to persist normalized HA event", { error });
        });
        if (entityMayAffectDashboard(entityId)) {
          scheduleDashboardStatePoll();
        }
      },
      (error) => {
        publishDashboardError(error.message);
        store.haStateChangeUnsubscribe?.();
        store.haStateChangeUnsubscribe = null;
        // Rebuild the subscription instead of degrading to 5s REST polling until
        // the whole process restarts (the old behaviour). A poll still runs on
        // reconnect so we don't miss changes during the gap.
        scheduleHaStateChangeReconnect();
      },
    );
    // Fresh subscription: catch up on anything that changed while we were gone.
    scheduleDashboardStatePoll();
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to subscribe to Home Assistant state changes");
    scheduleHaStateChangeReconnect();
  }
}
