// The background poller: iCloud sync, adaptive lighting, and the timers
// started for the first client and stopped when the last one leaves.

import { readDashboardConfigSync } from "../dashboard-config";
import { emitDashboardEvent } from "../event-spool";
import { runZoneLightRules, warmWeatherCache } from "../ha";
import { isIcloudEnabled, logIcloudDisabledOnce, readIcloudConfig } from "../icloud-config";
import { ensurePowerMonitorStarted } from "../power";
import {
  ADAPTIVE_LIGHTING_POLL_MS,
  DASHBOARD_BUILD_EVENT_POLL_MS,
  DASHBOARD_EVENT_HEARTBEAT_MS,
  DASHBOARD_EVENT_POLL_MS,
  ICLOUD_SYNC_INTERVAL_MS,
  TASK_ALERT_TICK_MS,
  WEATHER_REFRESH_INTERVAL_MS,
} from "./constants";
import { publishDashboardBuild, publishDashboardError, publishDashboardState } from "./publish";
import { pollDashboardState, startHaStateChangeSubscription } from "./state-poll";
import { store } from "./store";
import { scanTaskAlerts } from "./task-alerts";
import { broadcast, sendClient, sseEvent } from "./transport";

async function runIcloudSync(options: { force?: boolean } = {}) {
  const icloudConfig = readIcloudConfig();
  if (!isIcloudEnabled(icloudConfig)) {
    logIcloudDisabledOnce();
    return;
  }

  const now = Date.now();
  if (!options.force && now < store.nextIcloudSyncAt) {
    return;
  }
  if (store.icloudSyncing) {
    return;
  }

  store.icloudSyncing = true;
  try {
    const { syncIcloud } = await import("../icloud-sync");
    await syncIcloud();
    store.nextIcloudSyncAt = Date.now() + icloudConfig.syncIntervalMs;
  } catch {
    try {
      const { getIcloudSyncStatus } = await import("../icloud-sync");
      const status = getIcloudSyncStatus();
      const backoffUntil = status.authBackoffUntil ? new Date(status.authBackoffUntil).getTime() : 0;
      store.nextIcloudSyncAt = Number.isFinite(backoffUntil) && backoffUntil > Date.now()
        ? backoffUntil
        : Date.now() + icloudConfig.syncIntervalMs;
    } catch {
      store.nextIcloudSyncAt = Date.now() + icloudConfig.syncIntervalMs;
    }
  } finally {
    store.icloudSyncing = false;
  }
}

async function scanAdaptiveLighting() {
  if (store.adaptiveLightingTicking) {
    return;
  }

  store.adaptiveLightingTicking = true;
  try {
    // Each automation returns a state only when it actually changed something,
    // so emit the periodic event exactly on a real action (not every 60s tick).
    // Every lighting rule kind runs in one host pass (runZoneLightRules).
    for (const [event, state] of await runZoneLightRules()) {
      void emitDashboardEvent({ service: "lighting", event, source: "periodic" });
      publishDashboardState(state, { force: true });
    }
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to run lighting automation");
  } finally {
    store.adaptiveLightingTicking = false;
  }
}

export function startDashboardEventPoller() {
  ensurePowerMonitorStarted();
  const config = readDashboardConfigSync();
  const timing = config.dashboard.timing;
  const icloudConfig = readIcloudConfig();

  if (!store.buildPollTimer) {
    void publishDashboardBuild();
    store.buildPollTimer = setInterval(() => {
      void publishDashboardBuild();
    }, timing.dashboardBuildEventPollMs || DASHBOARD_BUILD_EVENT_POLL_MS);
  }

  if (!store.pollTimer) {
    void pollDashboardState();
    startHaStateChangeSubscription();
    store.pollTimer = setInterval(() => {
      void pollDashboardState();
    }, timing.dashboardEventPollMs || DASHBOARD_EVENT_POLL_MS);
  }

  if (!store.heartbeatTimer) {
    store.heartbeatTimer = setInterval(() => {
      // A comment line keeps proxies from idling the socket out, but browser JS
      // never sees comments — a half-open TCP connection looks identical to a
      // quiet healthy one from the page's side. The named heartbeat event is
      // what sharedDashboardEvents' liveness watchdog listens for: silence
      // longer than a few heartbeats means the stream is dead and must be
      // rebuilt even though its readyState still says OPEN.
      const heartbeat = sseEvent("heartbeat", JSON.stringify({ at: Date.now() }));
      broadcast(`: keep-alive\n\n${heartbeat}`);
      for (const client of store.taskClients) {
        sendClient(client, `: keep-alive\n\n${heartbeat}`);
      }
    }, timing.dashboardEventHeartbeatMs || DASHBOARD_EVENT_HEARTBEAT_MS);
  }

  if (!store.weatherRefreshTimer) {
    void warmWeatherCache();
    store.weatherRefreshTimer = setInterval(() => {
      void warmWeatherCache();
    }, timing.weatherRefreshIntervalMs || WEATHER_REFRESH_INTERVAL_MS);
  }

  if (!store.taskAlertTimer) {
    void scanTaskAlerts();
    store.taskAlertTimer = setInterval(() => {
      void scanTaskAlerts();
    }, TASK_ALERT_TICK_MS);
  }

  if (!store.adaptiveLightingTimer) {
    void scanAdaptiveLighting();
    store.adaptiveLightingTimer = setInterval(() => {
      void scanAdaptiveLighting();
    }, timing.adaptiveLightingPollMs || ADAPTIVE_LIGHTING_POLL_MS);
  }

  if (!store.icloudSyncTimer) {
    if (isIcloudEnabled(icloudConfig)) {
      void runIcloudSync({ force: true });
      store.icloudSyncTimer = setInterval(() => {
        void runIcloudSync();
      }, icloudConfig.syncIntervalMs || ICLOUD_SYNC_INTERVAL_MS);
    } else {
      logIcloudDisabledOnce();
    }
  }
}

export function stopDashboardEventPollerIfIdle() {
  if (
    store.householdEventBackboneStarted
    || store.clients.size > 0
    || store.taskClients.size > 0
  ) {
    return;
  }

  if (store.pollTimer) {
    clearInterval(store.pollTimer);
    store.pollTimer = null;
  }

  if (store.haStateChangeTimer) {
    clearTimeout(store.haStateChangeTimer);
    store.haStateChangeTimer = null;
  }

  if (store.haStateChangeUnsubscribe) {
    store.haStateChangeUnsubscribe();
    store.haStateChangeUnsubscribe = null;
  }

  if (store.buildPollTimer) {
    clearInterval(store.buildPollTimer);
    store.buildPollTimer = null;
  }

  if (store.heartbeatTimer) {
    clearInterval(store.heartbeatTimer);
    store.heartbeatTimer = null;
  }

  if (store.weatherRefreshTimer) {
    clearInterval(store.weatherRefreshTimer);
    store.weatherRefreshTimer = null;
  }

  if (store.taskAlertTimer) {
    clearInterval(store.taskAlertTimer);
    store.taskAlertTimer = null;
    store.taskAlertSessions = {};
  }

  if (store.adaptiveLightingTimer) {
    clearInterval(store.adaptiveLightingTimer);
    store.adaptiveLightingTimer = null;
  }

  if (store.icloudSyncTimer) {
    clearInterval(store.icloudSyncTimer);
    store.icloudSyncTimer = null;
  }
}
