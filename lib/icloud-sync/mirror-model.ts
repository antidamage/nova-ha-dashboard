// Pure: calendar selection, mirror keys, local-task linking and error
// classification.
import type { DAVCalendar } from "tsdav";
import type { Task } from "../types";
import { localDateKey } from "./time-model";

export function displayName(calendar: DAVCalendar) {
  if (typeof calendar.displayName === "string" && calendar.displayName.trim()) {
    return calendar.displayName.trim();
  }

  return calendar.url.replace(/\/$/, "").split("/").pop() || calendar.url;
}

export function allowedByName(name: string, allowList: string[]) {
  if (allowList.some((item) => ["__none__", "none"].includes(item.trim().toLowerCase()))) {
    return false;
  }
  return !allowList.length || allowList.includes(name);
}

export function supportsComponent(calendar: DAVCalendar, component: "VEVENT" | "VTODO") {
  if (!calendar.components?.length) {
    return true;
  }

  return calendar.components.some((candidate) => candidate.toUpperCase() === component);
}

export function mirrorKey(task: Task) {
  return `${task.source}|${task.sourceId ?? task.id}|${task.occurrenceDate ?? task.start.slice(0, 10)}`;
}

export function taskChanged(left: Task, right: Task) {
  return left.name !== right.name || left.start !== right.start || left.end !== right.end || left.sourceCalendar !== right.sourceCalendar;
}

export function normalizedTaskName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function localTaskMatchesReminder(localTask: Task, reminderTask: Task) {
  if (localTask.source !== "local" || reminderTask.source !== "icloud-reminders") {
    return false;
  }
  if (normalizedTaskName(localTask.name) !== normalizedTaskName(reminderTask.name)) {
    return false;
  }
  if (localTask.repeat) {
    return true;
  }
  return localDateKey(localTask.start) === localDateKey(reminderTask.start);
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "iCloud sync failed";
}

export function isAuthFailure(error: unknown) {
  const text = errorMessage(error).toLowerCase();
  return text.includes("401") || text.includes("403") || text.includes("unauthorized") || text.includes("forbidden");
}
