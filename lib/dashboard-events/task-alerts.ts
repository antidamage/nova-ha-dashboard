// Reminder alert scanning and the task / reminder-icon snapshots sent to a
// newly connected client.

import { emitDashboardEvent } from "../event-spool";
import { emitModuleEvent } from "../modules/runtime/hooks";
import type { Task } from "../types";
import { publishDashboardError } from "./publish";
import { store } from "./store";
import { broadcastTask, sendClient, sseEvent } from "./transport";
import type { DashboardEventClient } from "./types";

function isTaskAlerting(task: Task, now: number) {
  if ((task.moduleData?.["washing-machine"] as { phase?: string } | undefined)?.phase === "waiting") return false;
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

export async function sendReminderIconsSnapshot(client: DashboardEventClient) {
  try {
    const { readReminderIcons } = await import("../reminder-icons");
    store.latestReminderIconsJson = JSON.stringify({ entries: await readReminderIcons() });
    sendClient(client, sseEvent("reminder-icons", store.latestReminderIconsJson));
  } catch (error) {
    // The bar degrades to "no tiles" on its own; this is not worth a
    // dashboard-error toast the way a missing task list is.
    console.error("[nova-dashboard] Failed to read reminder icons", { error });
  }
}

export async function sendTasksSnapshot(client: DashboardEventClient) {
  try {
    const { readTasks } = await import("../tasks");
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

export async function scanTaskAlerts() {
  if (store.taskAlertTicking) {
    return;
  }

  store.taskAlertTicking = true;
  try {
    const { readTasks } = await import("../tasks");
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
      // Once per occurrence, on the same edge as the chime — not once per tick.
      emitModuleEvent({
        id: "reminder.due",
        at: task.start,
        source: "server",
        task: { id: task.id, name: task.name, moduleData: task.moduleData },
      });
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
