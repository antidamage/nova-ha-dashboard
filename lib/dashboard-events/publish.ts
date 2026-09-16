// Publish helpers for dashboard state, tasks, design, sounds, doorbell and
// orb-timer events. Voice events are in ./voice.

import { readDashboardBuildId } from "../build-id";
import { appendTaskSnapshotEvents } from "../household-events";
import type { DashboardState, SunStatus, Task } from "../types";
import { LIGHT_COMMAND_EVENT_HOLD_MS } from "./constants";
import { store } from "./store";
import {
  broadcast,
  broadcastTask,
  dashboardStateSignature,
  sendClient,
  sseEvent,
  withDashboardEventMetadata,
} from "./transport";
import type { DashboardEventClient } from "./types";

export async function publishDashboardBuild(options: { client?: DashboardEventClient; force?: boolean } = {}) {
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
  void appendTaskSnapshotEvents(tasks).catch((error) => {
    console.error("[nova-dashboard] Failed to persist normalized task events", { error });
  });
}

export function publishTaskDismiss(taskId: string) {
  delete store.taskAlertSessions[taskId];
  broadcastTask(sseEvent("task-dismiss", JSON.stringify({ taskId })));
}

// Sigil assignments for the reminder icon bar. Pushed on the same stream as
// tasks so a tile's icon and its due state can never disagree for long — the
// LLM classifier patches assignments asynchronously, well after the task that
// triggered it was written.
export function publishReminderIcons(entries: unknown[]) {
  store.latestReminderIconsJson = JSON.stringify({ entries });
  broadcastTask(sseEvent("reminder-icons", store.latestReminderIconsJson));
}

// The active Design (presentation layer) changed. Every screen in the house
// shares one design, so a change made on any of them has to reach the rest —
// otherwise the kiosk keeps the old presentation until someone reloads it.
// The payload carries the id rather than being a bare nudge: it is a single
// validated string, so there is nothing for a client to re-interpret and no
// reason to make every screen fetch. Receivers ignore an id they do not know.
export function publishDesign(activeId: string) {
  broadcast(sseEvent("design", JSON.stringify({ activeId, at: Date.now() })));
}

// Phonoscope configuration changed. The GPU renderer on voiceHost subscribes to
// this stream so a slider moved in the browser reaches the render in a frame or
// two instead of waiting for its next config poll. The payload is deliberately
// just a nudge — the renderer re-reads /api/phonoscope/config itself, which
// keeps exactly one code path for interpreting configuration.
export function publishPhonoscopeConfig(reason: string) {
  broadcast(sseEvent("phonoscope", JSON.stringify({ kind: "phonoscope", reason, at: Date.now() })));
}

// Fan a doorbell alert out to every connected client. Reuses the shared SSE
// stream rather than adding a second alert channel, so a client that already
// handles task alerts gets doorbell alerts with the same reconnect behaviour.
//
// The payload is the redacted alert only: it carries a knock COUNT, never the
// timings, because the stream reaches every browser on the network and the
// timings are an unlock credential.
export function publishDoorbellAlert(alert: unknown) {
  broadcast(sseEvent("doorbell-alert", JSON.stringify(alert)));
}

// A UX sound clip was uploaded, renamed or deleted. Every screen shares one
// library, so the change has to reach the rest; the payload is a nudge and each
// client re-reads /api/sounds, keeping one code path for interpreting it.
export function publishSoundLibrary(reason: string) {
  broadcast(sseEvent("sound-library", JSON.stringify({ reason, at: Date.now() })));
}

export function publishTaskAudioStatus(status: { exists: boolean; size?: number; updatedAt?: string }) {
  store.latestTaskAudioJson = JSON.stringify(status);
  broadcastTask(sseEvent("task-audio", store.latestTaskAudioJson));
}

export function holdDashboardEventLightPolling(durationMs = LIGHT_COMMAND_EVENT_HOLD_MS) {
  store.lightPollHoldUntil = Math.max(store.lightPollHoldUntil, Date.now() + durationMs);
}

export function publishOrbTimer(timer: import("../orb-timer-model").OrbTimer | null) {
  broadcast(sseEvent("orb-timer", JSON.stringify({ timer })));
}
