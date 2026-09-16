// Entry points: start the household event backbone, and open the dashboard
// and task SSE streams.

import { appendTaskSnapshotEvents } from "../household-events";
import { startDashboardEventPoller, stopDashboardEventPollerIfIdle } from "./poller";
import { publishDashboardBuild } from "./publish";
import { store } from "./store";
import { sendReminderIconsSnapshot, sendTasksSnapshot } from "./task-alerts";
import { sendClient, sseEvent } from "./transport";
import type { DashboardEventClient } from "./types";
import { sendVoiceSpeakingSnapshot } from "./voice";

export function ensureHouseholdEventBackboneStarted() {
  if (store.householdEventBackboneStarted) {
    return;
  }
  store.householdEventBackboneStarted = true;
  startDashboardEventPoller();
  void import("../tasks")
    .then(({ readTasks }) => readTasks())
    .then((tasks) => appendTaskSnapshotEvents(tasks))
    .catch((error) => {
      console.error("[nova-dashboard] Failed to seed normalized task events", { error });
    });
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
      void sendReminderIconsSnapshot(client);
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
      void sendReminderIconsSnapshot(client);

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
