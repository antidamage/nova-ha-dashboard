// Sole owner of dashboard event state. The store lives on globalThis
// (`__novaDashboardEvents`); every sibling reads and writes it through the
// `store` export. Do not add a second globalThis handle or a module-level
// `let` elsewhere in this package.

import type { DashboardEventClient, DashboardEventStore } from "./types";

export const encoder = new TextEncoder();
const globalWithDashboardEvents = globalThis as typeof globalThis & {
  __novaDashboardEvents?: DashboardEventStore;
};

export const store =
  globalWithDashboardEvents.__novaDashboardEvents ??
  (globalWithDashboardEvents.__novaDashboardEvents = {
    adaptiveLightingTimer: null,
    adaptiveLightingTicking: false,
    buildPollTimer: null,
    clients: new Set<DashboardEventClient>(),
    heartbeatTimer: null,
    householdEventBackboneStarted: false,
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
    latestReminderIconsJson: null,
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
store.householdEventBackboneStarted ??= false;
store.icloudSyncTimer ??= null;
store.icloudSyncing ??= false;
store.latestSun ??= null;
store.latestTaskAudioJson ??= null;
store.latestTasksJson ??= null;
store.latestReminderIconsJson ??= null;
store.nextIcloudSyncAt ??= 0;
store.pollPending ??= false;
store.taskClients ??= new Set<DashboardEventClient>();
store.taskAlertSessions ??= {};
store.taskAlertTimer ??= null;
store.taskAlertTicking ??= false;
store.voiceSpeaking ??= null;
store.voiceTranscripts ??= [];
