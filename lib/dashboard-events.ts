import { readDashboardBuildId } from "./build-id";
import { buildDashboardState, warmWeatherCache } from "./ha";
import { isIcloudEnabled, logIcloudDisabledOnce } from "./icloud-config";
import type { DashboardEntity, DashboardState, HaDomain, SpectrumCursor, Task } from "./types";

const DASHBOARD_BUILD_EVENT_POLL_MS = 5000;
const DASHBOARD_EVENT_POLL_MS = 2000;
const DASHBOARD_EVENT_HEARTBEAT_MS = 15000;
const LIGHT_COMMAND_EVENT_HOLD_MS = 5000;
const WEATHER_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const TASK_ALERT_TICK_MS = 1000;
const ICLOUD_SYNC_INTERVAL_MS = 10 * 60 * 1000;

type DashboardEventClient = {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

type DashboardEventStore = {
  buildPollTimer: ReturnType<typeof setInterval> | null;
  clients: Set<DashboardEventClient>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  icloudSyncTimer: ReturnType<typeof setInterval> | null;
  icloudSyncing: boolean;
  latestBuildId: string | null;
  latestJson: string | null;
  latestSignature: string | null;
  latestTaskAudioJson: string | null;
  latestTasksJson: string | null;
  lightPollHoldUntil: number;
  nextClientId: number;
  nextIcloudSyncAt: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  polling: boolean;
  spectrumCursors: Record<string, SpectrumCursor>;
  taskClients: Set<DashboardEventClient>;
  taskAlertSessions: Record<string, string>;
  taskAlertTimer: ReturnType<typeof setInterval> | null;
  taskAlertTicking: boolean;
  weatherRefreshTimer: ReturnType<typeof setInterval> | null;
};

const encoder = new TextEncoder();
const globalWithDashboardEvents = globalThis as typeof globalThis & {
  __novaDashboardEvents?: DashboardEventStore;
};

const store =
  globalWithDashboardEvents.__novaDashboardEvents ??
  (globalWithDashboardEvents.__novaDashboardEvents = {
    buildPollTimer: null,
    clients: new Set<DashboardEventClient>(),
    heartbeatTimer: null,
    icloudSyncTimer: null,
    icloudSyncing: false,
    latestBuildId: null,
    latestJson: null,
    latestSignature: null,
    latestTaskAudioJson: null,
    latestTasksJson: null,
    lightPollHoldUntil: 0,
    nextClientId: 0,
    nextIcloudSyncAt: 0,
    pollTimer: null,
    polling: false,
    spectrumCursors: {},
    taskClients: new Set<DashboardEventClient>(),
    taskAlertSessions: {},
    taskAlertTimer: null,
    taskAlertTicking: false,
    weatherRefreshTimer: null,
  });

store.icloudSyncTimer ??= null;
store.icloudSyncing ??= false;
store.latestTaskAudioJson ??= null;
store.latestTasksJson ??= null;
store.nextIcloudSyncAt ??= 0;
store.taskClients ??= new Set<DashboardEventClient>();
store.taskAlertSessions ??= {};
store.taskAlertTimer ??= null;
store.taskAlertTicking ??= false;

type ZoneActionInput = {
  action: string;
  brightnessPct?: number;
  cursor?: SpectrumCursor;
  rgb?: [number, number, number];
  zoneId: string;
};

type EntityActionInput = {
  data?: Record<string, unknown>;
  domain: HaDomain;
  entityId: string;
  service: string;
};

function dashboardStateSignature(state: DashboardState) {
  const { generatedAt: _generatedAt, ...snapshot } = state;
  return JSON.stringify(snapshot);
}

function clampCursor(cursor: SpectrumCursor) {
  return {
    x: Math.max(0, Math.min(1, Number(cursor.x))),
    y: Math.max(0, Math.min(1, Number(cursor.y))),
  };
}

export function rememberSpectrumCursor(zoneId: string, cursor?: SpectrumCursor) {
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
    return;
  }

  store.spectrumCursors[zoneId] = clampCursor(cursor);
}

export function withDashboardEventMetadata(state: DashboardState): DashboardState {
  return {
    ...state,
    spectrumCursors: { ...store.spectrumCursors },
  };
}

function sseEvent(event: string, data: string) {
  return `event: ${event}\ndata: ${data.replace(/\n/g, "\ndata: ")}\n\n`;
}

function sendClient(client: DashboardEventClient, chunk: string) {
  try {
    client.controller.enqueue(encoder.encode(chunk));
  } catch {
    store.clients.delete(client);
    store.taskClients.delete(client);
  }
}

function broadcast(chunk: string, options: { excludeClientId?: number | null } = {}) {
  for (const client of store.clients) {
    if (options.excludeClientId && client.id === options.excludeClientId) {
      continue;
    }

    sendClient(client, chunk);
  }
}

function broadcastTask(chunk: string) {
  broadcast(chunk);
  for (const client of store.taskClients) {
    sendClient(client, chunk);
  }
}

async function publishDashboardBuild(options: { client?: DashboardEventClient; force?: boolean } = {}) {
  const buildId = await readDashboardBuildId();
  const previousBuildId = store.latestBuildId;
  store.latestBuildId = buildId;

  if (options.client) {
    sendClient(options.client, sseEvent("build", JSON.stringify({ buildId })));
    return;
  }

  if (!options.force && previousBuildId === buildId) {
    return;
  }

  broadcast(sseEvent("build", JSON.stringify({ buildId })));

  if (previousBuildId && previousBuildId !== buildId) {
    broadcast(sseEvent("reload", JSON.stringify({ buildId, previousBuildId, reason: "build-changed" })));
  }
}

export function publishDashboardState(
  state: DashboardState,
  options: { excludeClientId?: number | null; force?: boolean } = {},
) {
  if (!options.force && Date.now() < store.lightPollHoldUntil) {
    return;
  }

  const stateWithMetadata = withDashboardEventMetadata(state);
  const signature = dashboardStateSignature(stateWithMetadata);
  if (!options.force && signature === store.latestSignature) {
    return;
  }

  store.latestSignature = signature;
  store.latestJson = JSON.stringify(stateWithMetadata);
  broadcast(sseEvent("state", store.latestJson), { excludeClientId: options.excludeClientId });
}

export function publishDashboardError(message: string) {
  broadcast(sseEvent("dashboard-error", JSON.stringify({ message })));
}

export function publishTasks(tasks: Task[]) {
  store.latestTasksJson = JSON.stringify({ tasks });
  broadcastTask(sseEvent("tasks", store.latestTasksJson));
}

export function publishTaskDismiss(taskId: string) {
  delete store.taskAlertSessions[taskId];
  broadcastTask(sseEvent("task-dismiss", JSON.stringify({ taskId })));
}

export function publishTaskAudioStatus(status: { exists: boolean; size?: number; updatedAt?: string }) {
  store.latestTaskAudioJson = JSON.stringify(status);
  broadcastTask(sseEvent("task-audio", store.latestTaskAudioJson));
}

export function holdDashboardEventLightPolling(durationMs = LIGHT_COMMAND_EVENT_HOLD_MS) {
  store.lightPollHoldUntil = Math.max(store.lightPollHoldUntil, Date.now() + durationMs);
}

function isDashboardEntityOn(entity: DashboardEntity) {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }
  if (entity.domain === "climate") {
    return entity.state !== "off";
  }
  return ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"].includes(entity.state);
}

function brightnessPctFromEntities(entities: DashboardEntity[]) {
  const values = entities
    .filter((entity) => entity.domain === "light" && entity.state === "on")
    .map((entity) => Number(entity.attributes.brightness ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) {
    return 0;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average / 255) * 100);
}

function brightnessAttributeFromPct(value: unknown) {
  const brightnessPct = Number(value);
  if (!Number.isFinite(brightnessPct)) {
    return null;
  }

  return Math.round((Math.max(0, Math.min(100, brightnessPct)) / 100) * 255);
}

function numberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length < length) {
    return null;
  }

  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function withDashboardEntityUpdates(
  state: DashboardState,
  updateEntity: (entity: DashboardEntity) => DashboardEntity,
) {
  const entities = state.entities.map(updateEntity);
  const entityById = new Map(entities.map((entity) => [entity.entity_id, entity]));

  return {
    ...state,
    entities,
    zones: state.zones.map((zone) => {
      const zoneEntities = zone.entities.map((entity) => entityById.get(entity.entity_id) ?? entity);
      return {
        ...zone,
        entities: zoneEntities,
        isOn: zoneEntities.some(isDashboardEntityOn),
        brightnessPct: brightnessPctFromEntities(zoneEntities),
      };
    }),
  };
}

function optimisticZoneEntity(
  entity: DashboardEntity,
  action: string,
  brightnessPct: number,
  rgb: [number, number, number] | null,
) {
  const brightness = brightnessAttributeFromPct(brightnessPct) ?? 255;
  const color = rgb ?? (action === "white" ? [255, 255, 255] : [255, 147, 41]);

  if (action === "off") {
    if (entity.domain === "light" || (entity.domain === "switch" && entity.isIllumination)) {
      return { ...entity, state: "off" };
    }
    return entity;
  }

  if (action === "brightness") {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: brightnessPct <= 0 ? "off" : "on",
        attributes: { ...entity.attributes, brightness },
      };
    }
    if (entity.domain === "switch" && entity.isIllumination) {
      return { ...entity, state: brightnessPct <= 0 ? "off" : "on" };
    }
    return entity;
  }

  if (["color", "on", "candlelight", "white"].includes(action)) {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: "on",
        attributes: { ...entity.attributes, brightness, rgb_color: color },
      };
    }
    if (entity.domain === "switch" && (entity.isIllumination || action === "on")) {
      return { ...entity, state: "on" };
    }
  }

  return entity;
}

export function isLightZoneAction(action: string) {
  return ["on", "off", "brightness", "color", "candlelight", "white"].includes(action);
}

export function optimisticDashboardStateForZoneAction(state: DashboardState, input: ZoneActionInput) {
  const zone = state.zones.find((candidate) => candidate.id === input.zoneId);
  if (!zone || !isLightZoneAction(input.action)) {
    return state;
  }

  const entityIds = new Set(zone.entities.map((entity) => entity.entity_id));
  const brightnessPct = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? zone.brightnessPct ?? 100)));
  const rgb = input.rgb ?? null;

  return withDashboardEntityUpdates(state, (entity) =>
    entityIds.has(entity.entity_id) ? optimisticZoneEntity(entity, input.action, brightnessPct, rgb) : entity,
  );
}

export function entityActionAffectsLighting(state: DashboardState, input: EntityActionInput) {
  if (input.domain === "light") {
    return true;
  }
  if (input.domain !== "switch") {
    return false;
  }

  return state.entities.some((entity) => entity.entity_id === input.entityId && entity.isIllumination);
}

export function optimisticDashboardStateForEntityAction(state: DashboardState, input: EntityActionInput) {
  if (!entityActionAffectsLighting(state, input)) {
    return state;
  }

  return withDashboardEntityUpdates(state, (entity) => {
    if (entity.entity_id !== input.entityId) {
      return entity;
    }

    let nextState = entity.state;
    let attributes = entity.attributes;
    const data = input.data ?? {};

    if (input.service === "turn_on") {
      nextState = "on";
    } else if (input.service === "turn_off") {
      nextState = "off";
    } else if (input.service === "toggle") {
      nextState = entity.state === "on" ? "off" : "on";
    }

    const brightness = brightnessAttributeFromPct(data.brightness_pct);
    if (brightness !== null) {
      attributes = { ...attributes, brightness };
      nextState = brightness <= 0 ? "off" : "on";
    }

    const rgb = numberArray(data.rgb_color, 3);
    if (rgb) {
      attributes = {
        ...attributes,
        rgb_color: rgb.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(part)))),
      };
      nextState = "on";
    }

    return { ...entity, state: nextState, attributes };
  });
}

async function pollDashboardState() {
  if (store.polling) {
    return;
  }

  if (Date.now() < store.lightPollHoldUntil) {
    return;
  }

  store.polling = true;
  try {
    publishDashboardState(await buildDashboardState());
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to refresh dashboard state");
  } finally {
    store.polling = false;
  }
}

function isTaskAlerting(task: Task, now: number) {
  if (task.dismissedAt) {
    return false;
  }

  const start = new Date(task.start).getTime();
  if (!Number.isFinite(start) || start > now) {
    return false;
  }

  if (!task.end) {
    return true;
  }

  const end = new Date(task.end).getTime();
  return Number.isFinite(end) && now < end;
}

async function sendTasksSnapshot(client: DashboardEventClient) {
  try {
    const { readTasks } = await import("./tasks");
    store.latestTasksJson = JSON.stringify({ tasks: await readTasks() });

    sendClient(client, sseEvent("tasks", store.latestTasksJson));
  } catch (error) {
    sendClient(
      client,
      sseEvent(
        "dashboard-error",
        JSON.stringify({ message: error instanceof Error ? error.message : "Failed to read scheduled tasks" }),
      ),
    );
  }
}

async function scanTaskAlerts() {
  if (store.taskAlertTicking) {
    return;
  }

  store.taskAlertTicking = true;
  try {
    const { readTasks } = await import("./tasks");
    const tasks = await readTasks();
    const now = Date.now();
    const activeAlertingTaskIds = new Set<string>();

    for (const task of tasks) {
      if (!isTaskAlerting(task, now)) {
        delete store.taskAlertSessions[task.id];
        continue;
      }

      activeAlertingTaskIds.add(task.id);
      const sessionKey = `${task.start}:${task.end ?? "reminder"}`;
      if (store.taskAlertSessions[task.id] === sessionKey) {
        continue;
      }

      store.taskAlertSessions[task.id] = sessionKey;
      broadcastTask(sseEvent("task-alert", JSON.stringify({ taskId: task.id, name: task.name, end: task.end })));
    }

    for (const taskId of Object.keys(store.taskAlertSessions)) {
      if (!activeAlertingTaskIds.has(taskId)) {
        delete store.taskAlertSessions[taskId];
      }
    }
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to scan task alerts");
  } finally {
    store.taskAlertTicking = false;
  }
}

async function runIcloudSync(options: { force?: boolean } = {}) {
  if (!isIcloudEnabled()) {
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
    const { syncIcloud } = await import("./icloud-sync");
    await syncIcloud();
    store.nextIcloudSyncAt = Date.now() + ICLOUD_SYNC_INTERVAL_MS;
  } catch {
    try {
      const { getIcloudSyncStatus } = await import("./icloud-sync");
      const status = getIcloudSyncStatus();
      const backoffUntil = status.authBackoffUntil ? new Date(status.authBackoffUntil).getTime() : 0;
      store.nextIcloudSyncAt = Number.isFinite(backoffUntil) && backoffUntil > Date.now()
        ? backoffUntil
        : Date.now() + ICLOUD_SYNC_INTERVAL_MS;
    } catch {
      store.nextIcloudSyncAt = Date.now() + ICLOUD_SYNC_INTERVAL_MS;
    }
  } finally {
    store.icloudSyncing = false;
  }
}

function startDashboardEventPoller() {
  if (!store.buildPollTimer) {
    void publishDashboardBuild();
    store.buildPollTimer = setInterval(() => {
      void publishDashboardBuild();
    }, DASHBOARD_BUILD_EVENT_POLL_MS);
  }

  if (!store.pollTimer) {
    void pollDashboardState();
    store.pollTimer = setInterval(() => {
      void pollDashboardState();
    }, DASHBOARD_EVENT_POLL_MS);
  }

  if (!store.heartbeatTimer) {
    store.heartbeatTimer = setInterval(() => {
      broadcast(": keep-alive\n\n");
      for (const client of store.taskClients) {
        sendClient(client, ": keep-alive\n\n");
      }
    }, DASHBOARD_EVENT_HEARTBEAT_MS);
  }

  if (!store.weatherRefreshTimer) {
    void warmWeatherCache();
    store.weatherRefreshTimer = setInterval(() => {
      void warmWeatherCache();
    }, WEATHER_REFRESH_INTERVAL_MS);
  }

  if (!store.taskAlertTimer) {
    void scanTaskAlerts();
    store.taskAlertTimer = setInterval(() => {
      void scanTaskAlerts();
    }, TASK_ALERT_TICK_MS);
  }

  if (!store.icloudSyncTimer) {
    if (isIcloudEnabled()) {
      void runIcloudSync({ force: true });
      store.icloudSyncTimer = setInterval(() => {
        void runIcloudSync();
      }, ICLOUD_SYNC_INTERVAL_MS);
    } else {
      logIcloudDisabledOnce();
    }
  }
}

function stopDashboardEventPollerIfIdle() {
  if (store.clients.size > 0 || store.taskClients.size > 0) {
    return;
  }

  if (store.pollTimer) {
    clearInterval(store.pollTimer);
    store.pollTimer = null;
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

  if (store.icloudSyncTimer) {
    clearInterval(store.icloudSyncTimer);
    store.icloudSyncTimer = null;
  }
}

export function subscribeDashboardEvents() {
  let client: DashboardEventClient | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      client = {
        id: store.nextClientId + 1,
        controller,
      };
      store.nextClientId = client.id;
      store.clients.add(client);

      sendClient(client, "retry: 2000\n\n");
      sendClient(client, sseEvent("client-id", JSON.stringify({ id: client.id })));
      void publishDashboardBuild({ client });
      if (store.latestJson) {
        sendClient(client, sseEvent("state", store.latestJson));
      }
      void sendTasksSnapshot(client);
      if (store.latestTaskAudioJson) {
        sendClient(client, sseEvent("task-audio", store.latestTaskAudioJson));
      }

      startDashboardEventPoller();
    },
    cancel() {
      if (client) {
        store.clients.delete(client);
      }
      stopDashboardEventPollerIfIdle();
    },
  });
}

export function subscribeTaskEvents() {
  let client: DashboardEventClient | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      client = {
        id: store.nextClientId + 1,
        controller,
      };
      store.nextClientId = client.id;
      store.taskClients.add(client);

      sendClient(client, "retry: 2000\n\n");
      sendClient(client, sseEvent("client-id", JSON.stringify({ id: client.id })));
      void sendTasksSnapshot(client);
      if (store.latestTaskAudioJson) {
        sendClient(client, sseEvent("task-audio", store.latestTaskAudioJson));
      }

      startDashboardEventPoller();
    },
    cancel() {
      if (client) {
        store.taskClients.delete(client);
      }
      stopDashboardEventPollerIfIdle();
    },
  });
}
