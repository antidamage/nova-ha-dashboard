import { readDashboardBuildId } from "./build-id";
import {
  applyAdaptiveCandlelightTransitions,
  applyLightingIntensityThresholds,
  applyPinnedLightPresets,
  buildDashboardState,
  subscribeHaStateChanges,
  warmWeatherCache,
} from "./ha";
import { emitDashboardEvent } from "./event-spool";
import { isIcloudEnabled, logIcloudDisabledOnce, readIcloudConfig } from "./icloud-config";
import { ensurePowerMonitorStarted } from "./power";
import { readDashboardConfigSync } from "./dashboard-config";
import { isEntitySuppressedByIntensity } from "./lighting-thresholds";
import {
  MAX_VOICE_TRANSCRIPTS,
  VOICE_TRANSCRIPT_RETENTION_MS,
  type VoiceTranscriptEvent,
} from "./voice-transcript";
import {
  adaptiveLightBrightnessPctForEntity,
  adaptiveLightColorTemperatureKelvinForEntity,
  adaptiveLightMode,
} from "./lighting-presets";
import type { DashboardEntity, DashboardLightingConfig, DashboardState, HaDomain, SpectrumCursor, SunStatus, Task } from "./types";

const DASHBOARD_BUILD_EVENT_POLL_MS = 5000;
const DASHBOARD_EVENT_POLL_MS = 5000;
const DASHBOARD_EVENT_HEARTBEAT_MS = 15000;
const DASHBOARD_EVENT_PUSH_DEBOUNCE_MS = 150;
const LIGHT_COMMAND_EVENT_HOLD_MS = 5000;
const WEATHER_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const TASK_ALERT_TICK_MS = 1000;
const ICLOUD_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const ADAPTIVE_LIGHTING_POLL_MS = 60 * 1000;
const HA_WS_RECONNECT_MIN_MS = 2000;
const HA_WS_RECONNECT_MAX_MS = 30000;

type DashboardEventClient = {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

type DashboardEventStore = {
  adaptiveLightingTimer: ReturnType<typeof setInterval> | null;
  adaptiveLightingTicking: boolean;
  buildPollTimer: ReturnType<typeof setInterval> | null;
  clients: Set<DashboardEventClient>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  haStateChangeTimer: ReturnType<typeof setTimeout> | null;
  haStateChangeUnsubscribe: (() => void) | null;
  haStateChangeReconnectTimer: ReturnType<typeof setTimeout> | null;
  haStateChangeReconnectAttempts: number;
  haHealthStatus: "ok" | "degraded";
  icloudSyncTimer: ReturnType<typeof setInterval> | null;
  icloudSyncing: boolean;
  latestBuildId: string | null;
  latestJson: string | null;
  latestSignature: string | null;
  latestSun: SunStatus | null;
  latestTaskAudioJson: string | null;
  latestTasksJson: string | null;
  lightPollHoldUntil: number;
  nextClientId: number;
  nextIcloudSyncAt: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollPending: boolean;
  polling: boolean;
  spectrumCursors: Record<string, SpectrumCursor>;
  taskClients: Set<DashboardEventClient>;
  taskAlertSessions: Record<string, string>;
  taskAlertTimer: ReturnType<typeof setInterval> | null;
  taskAlertTicking: boolean;
  voiceSpeaking: { json: string; turnId: string; receivedAt: number; expiresAt: number } | null;
  voiceTranscripts: VoiceTranscriptEvent[];
  weatherRefreshTimer: ReturnType<typeof setInterval> | null;
};

const encoder = new TextEncoder();
const globalWithDashboardEvents = globalThis as typeof globalThis & {
  __novaDashboardEvents?: DashboardEventStore;
};

const store =
  globalWithDashboardEvents.__novaDashboardEvents ??
  (globalWithDashboardEvents.__novaDashboardEvents = {
    adaptiveLightingTimer: null,
    adaptiveLightingTicking: false,
    buildPollTimer: null,
    clients: new Set<DashboardEventClient>(),
    heartbeatTimer: null,
    haStateChangeTimer: null,
    haStateChangeUnsubscribe: null,
    haStateChangeReconnectTimer: null,
    haStateChangeReconnectAttempts: 0,
    haHealthStatus: "ok",
    icloudSyncTimer: null,
    icloudSyncing: false,
    latestBuildId: null,
    latestJson: null,
    latestSignature: null,
    latestSun: null,
    latestTaskAudioJson: null,
    latestTasksJson: null,
    lightPollHoldUntil: 0,
    nextClientId: 0,
    nextIcloudSyncAt: 0,
    pollTimer: null,
    pollPending: false,
    polling: false,
    spectrumCursors: {},
    taskClients: new Set<DashboardEventClient>(),
    taskAlertSessions: {},
    taskAlertTimer: null,
    taskAlertTicking: false,
    voiceSpeaking: null,
    voiceTranscripts: [],
    weatherRefreshTimer: null,
  });

store.adaptiveLightingTimer ??= null;
store.adaptiveLightingTicking ??= false;
store.haStateChangeTimer ??= null;
store.haStateChangeUnsubscribe ??= null;
store.haStateChangeReconnectTimer ??= null;
store.haStateChangeReconnectAttempts ??= 0;
store.haHealthStatus ??= "ok";
store.icloudSyncTimer ??= null;
store.icloudSyncing ??= false;
store.latestSun ??= null;
store.latestTaskAudioJson ??= null;
store.latestTasksJson ??= null;
store.nextIcloudSyncAt ??= 0;
store.pollPending ??= false;
store.taskClients ??= new Set<DashboardEventClient>();
store.taskAlertSessions ??= {};
store.taskAlertTimer ??= null;
store.taskAlertTicking ??= false;
store.voiceSpeaking ??= null;
store.voiceTranscripts ??= [];

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
  // Unknown id (BUILD_ID never readable this process) — say nothing. Clients
  // ignore falsy ids, and recording it would make the next successful read
  // look like a version change. There is deliberately no server-pushed
  // "reload" event any more: each client compares ids in handleBuildId and
  // reloads itself exactly when ITS build differs, so a server-side flap can
  // never mass-reload every screen at once.
  if (!buildId) {
    return;
  }
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
}

/**
 * Last sun status seen by the state poller. Lets the server layout resolve
 * the auto light/dark theme variant with real sun data on first paint instead
 * of the hour-of-day guess (which also depends on the container's TZ).
 */
export function getLatestDashboardSun(): SunStatus | null {
  return store.latestSun;
}

export function publishDashboardState(
  state: DashboardState,
  options: { excludeClientId?: number | null; force?: boolean } = {},
) {
  // Capture the sun even when the broadcast below is deduped or held back —
  // the first-paint theme seed (getLatestDashboardSun) wants the newest value.
  store.latestSun = state.sun ?? null;
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

export type VoiceSpeakingEvent = {
  phase: "start" | "end";
  turnId: string;
  satelliteId?: string;
  roomId?: string;
  /** Consonant-onset offsets in ms from audible speech start (start phase). */
  timingsMs?: number[];
  estimatedDurationMs?: number;
  /** Estimated delay between this event and audio leaving the speaker. */
  audibleOffsetMs?: number;
  /** Actual synthesized audio duration (end phase). */
  playedDurationMs?: number;
  /** How long ago the start was received — nonzero only on mid-speech replay
   *  to a freshly connected client. */
  elapsedMs?: number;
};

// Fan a nova-voice speaking event out to every connected client. The latest
// start is kept (with an expiry) so a client that connects mid-speech still
// raises its orb; the matching end clears it.
export function publishVoiceSpeaking(event: VoiceSpeakingEvent) {
  const now = Date.now();
  if (event.phase === "start") {
    const estimated = Number(event.estimatedDurationMs) || 0;
    store.voiceSpeaking = {
      json: JSON.stringify(event),
      turnId: event.turnId,
      receivedAt: now,
      // Generous bound: estimate can undershoot, and the client keeps its own
      // safety timeout anyway.
      expiresAt: now + (event.audibleOffsetMs ?? 0) + Math.max(estimated * 2, estimated + 10_000),
    };
  } else if (store.voiceSpeaking?.turnId === event.turnId) {
    store.voiceSpeaking = null;
  }
  broadcast(sseEvent("voice-speaking", JSON.stringify(event)));
}

// Keep a short process-local transcript so opening the Voice Agent panel after
// a turn still shows recent context. Iridium remains the durable 24-hour
// transcript owner; the dashboard only fans out and displays this bounded copy.
export function publishVoiceTranscript(event: VoiceTranscriptEvent) {
  store.voiceTranscripts.push(event);
  const expiresBefore = Date.now() - VOICE_TRANSCRIPT_RETENTION_MS;
  store.voiceTranscripts = store.voiceTranscripts.filter(
    (entry) => new Date(entry.at).getTime() > expiresBefore,
  );
  if (store.voiceTranscripts.length > MAX_VOICE_TRANSCRIPTS) {
    store.voiceTranscripts.splice(0, store.voiceTranscripts.length - MAX_VOICE_TRANSCRIPTS);
  }
  broadcast(sseEvent("voice-transcript", JSON.stringify(event)));
}

// Upgrade an existing transcript line in place — the voice server posts this
// when a longer rendering of an already-displayed near-duplicate arrives, so
// the panel keeps one line per utterance instead of appending both.
export function replaceVoiceTranscript(
  replacesId: string,
  text: string,
  at: string,
): VoiceTranscriptEvent | null {
  const entry = store.voiceTranscripts.find((item) => item.id === replacesId);
  if (!entry) {
    return null;
  }
  entry.text = text;
  entry.at = at;
  broadcast(sseEvent("voice-transcript-replaced", JSON.stringify(entry)));
  return { ...entry };
}

export function getVoiceTranscripts(): VoiceTranscriptEvent[] {
  const expiresBefore = Date.now() - VOICE_TRANSCRIPT_RETENTION_MS;
  store.voiceTranscripts = store.voiceTranscripts.filter(
    (entry) => new Date(entry.at).getTime() > expiresBefore,
  );
  return store.voiceTranscripts.map((entry) => ({ ...entry }));
}

export function clearVoiceTranscripts() {
  const event = { clearedAt: new Date().toISOString() };
  store.voiceTranscripts = [];
  broadcast(sseEvent("voice-transcript-cleared", JSON.stringify(event)));
  return event;
}

function sendVoiceSpeakingSnapshot(client: DashboardEventClient) {
  const active = store.voiceSpeaking;
  if (!active) {
    return;
  }
  const now = Date.now();
  if (now >= active.expiresAt) {
    store.voiceSpeaking = null;
    return;
  }
  const replay = { ...(JSON.parse(active.json) as VoiceSpeakingEvent), elapsedMs: now - active.receivedAt };
  sendClient(client, sseEvent("voice-speaking", JSON.stringify(replay)));
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
  lighting?: DashboardLightingConfig,
) {
  const brightness = brightnessAttributeFromPct(brightnessPct) ?? 255;
  const color = rgb ?? (action === "white" ? [255, 255, 255] : [255, 147, 41]);

  if (action !== "off" && isEntitySuppressedByIntensity(entity, brightnessPct, lighting)) {
    if (entity.domain === "light") {
      return { ...entity, state: "off", attributes: { ...entity.attributes, brightness: 0 } };
    }
    if (entity.domain === "switch") {
      return { ...entity, state: "off" };
    }
  }

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

function adaptiveCandlelightRgb(state: DashboardState): [number, number, number] {
  return state.sun?.state === "below_horizon" ? [255, 147, 41] : [255, 214, 170];
}

function optimisticAdaptiveBrightnessPct(entity: DashboardEntity, action: string, brightnessPct: number, state: DashboardState) {
  if (entity.domain !== "light" || !["on", "candlelight"].includes(action)) {
    return brightnessPct;
  }
  return adaptiveLightBrightnessPctForEntity(entity, state.lighting, adaptiveLightMode(state.sun), brightnessPct);
}

function optimisticAdaptiveRgb(
  entity: DashboardEntity,
  action: string,
  rgb: [number, number, number] | null,
  state: DashboardState,
) {
  if (entity.domain !== "light" || !["on", "candlelight"].includes(action)) {
    return rgb;
  }
  const kelvin = adaptiveLightColorTemperatureKelvinForEntity(entity, state.lighting, adaptiveLightMode(state.sun));
  return kelvin !== null && kelvin >= 5000 ? [255, 255, 255] as [number, number, number] : rgb;
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
  const rgb = input.rgb ?? (["on", "candlelight"].includes(input.action) ? adaptiveCandlelightRgb(state) : null);

  return withDashboardEntityUpdates(state, (entity) =>
    entityIds.has(entity.entity_id)
      ? optimisticZoneEntity(
          entity,
          input.action,
          optimisticAdaptiveBrightnessPct(entity, input.action, brightnessPct, state),
          optimisticAdaptiveRgb(entity, input.action, rgb, state),
          state.lighting,
        )
      : entity,
  );
}

export function optimisticDashboardStateForLightingEntityIdsAction(
  state: DashboardState,
  input: Omit<ZoneActionInput, "zoneId"> & { entityIds: string[] },
) {
  if (!isLightZoneAction(input.action)) {
    return state;
  }

  const entityIds = new Set(input.entityIds);
  const brightnessPct = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? 100)));
  const rgb = input.rgb ?? (["on", "candlelight"].includes(input.action) ? adaptiveCandlelightRgb(state) : null);

  return withDashboardEntityUpdates(state, (entity) =>
    entityIds.has(entity.entity_id)
      ? optimisticZoneEntity(
          entity,
          input.action,
          optimisticAdaptiveBrightnessPct(entity, input.action, brightnessPct, state),
          optimisticAdaptiveRgb(entity, input.action, rgb, state),
          state.lighting,
        )
      : entity,
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

async function pollDashboardState() {
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

function startHaStateChangeSubscription() {
  if (store.haStateChangeUnsubscribe) {
    return;
  }

  try {
    store.haStateChangeUnsubscribe = subscribeHaStateChanges(
      (entityId) => {
        // Any successful event means the socket is healthy again — reset backoff.
        store.haStateChangeReconnectAttempts = 0;
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

function isTaskAlerting(task: Task, now: number) {
  if (task.dismissedAt) {
    return false;
  }

  const start = new Date(task.start).getTime();
  if (!Number.isFinite(start) || start > now) {
    return false;
  }

  const sessionKey = `${task.start}:${task.end ?? "reminder"}`;
  if (task.alertDismissedFor === sessionKey) {
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
        JSON.stringify({ message: error instanceof Error ? error.message : "Failed to read scheduled reminders" }),
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
      void emitDashboardEvent({
        service: "system",
        event: "reminder-alert",
        source: "periodic",
        detail: { taskId: task.id, name: task.name },
      });
    }

    for (const taskId of Object.keys(store.taskAlertSessions)) {
      if (!activeAlertingTaskIds.has(taskId)) {
        delete store.taskAlertSessions[taskId];
      }
    }
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to scan reminder alerts");
  } finally {
    store.taskAlertTicking = false;
  }
}

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
    const { syncIcloud } = await import("./icloud-sync");
    await syncIcloud();
    store.nextIcloudSyncAt = Date.now() + icloudConfig.syncIntervalMs;
  } catch {
    try {
      const { getIcloudSyncStatus } = await import("./icloud-sync");
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
    const automations: Array<[string, () => Promise<DashboardState | null | undefined>]> = [
      ["adaptive-candlelight", applyAdaptiveCandlelightTransitions],
      ["intensity-threshold", applyLightingIntensityThresholds],
      ["pinned-preset", applyPinnedLightPresets],
    ];
    for (const [event, run] of automations) {
      const state = await run();
      if (state) {
        void emitDashboardEvent({ service: "lighting", event, source: "periodic" });
        publishDashboardState(state, { force: true });
      }
    }
  } catch (error) {
    publishDashboardError(error instanceof Error ? error.message : "Failed to run lighting automation");
  } finally {
    store.adaptiveLightingTicking = false;
  }
}

function startDashboardEventPoller() {
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

function stopDashboardEventPollerIfIdle() {
  if (store.clients.size > 0 || store.taskClients.size > 0) {
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
      sendVoiceSpeakingSnapshot(client);

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
