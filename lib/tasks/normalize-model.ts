// Pure validation and normalisation: raw values in, a Task (or a field of one)
// out. Every write path goes through here before it reaches the store.
import type { Task, TaskFollows, TaskRepeat } from "../types";
import { MAX_FOLLOW_OFFSET_DAYS, MAX_REPEAT_DAYS, MIN_REPEAT_DAYS } from "./constants";
import { ensureEndAfterStart, ensureRepeatWindow, refreshedRepeatingTask } from "./schedule-model";
import type { TaskInput } from "./types";

export function randomTaskId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizedDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid`);
  }

  return date.toISOString();
}

export function normalizedOptionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }

  return normalizedDate(value, fieldName);
}

export function normalizedName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Reminder name is required");
  }

  return value.trim();
}

export function normalizedRepeat(value: unknown): TaskRepeat | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as { kind?: unknown; intervalDays?: unknown };
  if (candidate.kind === "hourly") {
    return { kind: "hourly" };
  }
  if (candidate.kind === "morning-night") {
    return { kind: "morning-night" };
  }
  if (candidate.kind === "days") {
    const intervalDays = Number(candidate.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < MIN_REPEAT_DAYS || intervalDays > MAX_REPEAT_DAYS) {
      throw new Error(`Repeat days must be between ${MIN_REPEAT_DAYS} and ${MAX_REPEAT_DAYS}`);
    }

    return { kind: "days", intervalDays };
  }

  return undefined;
}

export function normalizedFollows(value: unknown, selfId: string | undefined): TaskFollows | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as { taskId?: unknown; offsetDays?: unknown; hour?: unknown };
  const taskId = typeof candidate.taskId === "string" ? candidate.taskId.trim() : "";
  if (!taskId) {
    return undefined;
  }
  if (selfId && taskId === selfId) {
    throw new Error("A reminder cannot follow itself");
  }

  const offsetDays = Number(candidate.offsetDays);
  if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > MAX_FOLLOW_OFFSET_DAYS) {
    throw new Error(`Follow-on offset must be between 0 and ${MAX_FOLLOW_OFFSET_DAYS} days`);
  }

  const hour = Number(candidate.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error("Follow-on hour must be between 0 and 23");
  }

  return { taskId, offsetDays, hour };
}


export function normalizedTask(value: unknown): Task | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<Task>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.start !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  const source = candidate.source ?? "local";
  if (!["local", "icloud-calendar", "icloud-reminders"].includes(source)) {
    return null;
  }

  const start = normalizedDate(candidate.start, "Reminder start");
  const end = normalizedOptionalDate(candidate.end, "Reminder end");
  const follows = source === "local" ? normalizedFollows(candidate.follows, candidate.id) : undefined;
  const repeat = source === "local" && !follows ? normalizedRepeat(candidate.repeat) : undefined;
  ensureEndAfterStart(start, end);
  ensureRepeatWindow(start, end, repeat);

  return {
    id: candidate.id,
    name: candidate.name,
    start,
    end,
    createdAt: normalizedDate(candidate.createdAt, "Reminder creation time"),
    dismissedAt: candidate.dismissedAt ? normalizedDate(candidate.dismissedAt, "Reminder dismissal time") : undefined,
    alertDismissedAt: candidate.alertDismissedAt
      ? normalizedDate(candidate.alertDismissedAt, "Reminder alert dismissal time")
      : undefined,
    alertDismissedFor: typeof candidate.alertDismissedFor === "string" && candidate.alertDismissedFor.trim()
      ? candidate.alertDismissedFor.trim()
      : undefined,
    alertChimedFor: typeof candidate.alertChimedFor === "string" && candidate.alertChimedFor.trim()
      ? candidate.alertChimedFor.trim()
      : undefined,
    annoy: candidate.annoy === true ? true : undefined,
    moduleData: normalizedModuleData(candidate.moduleData),
    repeat,
    follows,
    source,
    sourceId: candidate.sourceId,
    sourceCalendar: candidate.sourceCalendar,
    occurrenceDate: candidate.occurrenceDate,
    readOnly: candidate.readOnly ?? source !== "local",
    recurs: candidate.recurs === true ? true : undefined,
  };
}

/**
 * Per-module reminder state. Only plain objects keyed by module id survive —
 * anything else is dropped rather than stored, so a bad client write cannot put
 * a scalar where a module expects its own record.
 */
export function normalizedModuleData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^[a-z][a-z0-9-]{1,38}$/.test(key) && entry && typeof entry === "object" && !Array.isArray(entry)) {
      next[key] = entry;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

/**
 * Merge per-module reminder state one module id at a time. A module id present
 * in the patch replaces that module's record; every other module's is left
 * alone. Setting a module's value to null removes it.
 */
export function mergedModuleData(
  current: Record<string, unknown> | undefined,
  patch: unknown,
): Record<string, unknown> | undefined {
  if (patch === null) {
    return undefined;
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return current;
  }
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [moduleId, value] of Object.entries(patch as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]{1,38}$/.test(moduleId)) {
      continue;
    }
    if (value === null || value === undefined) {
      delete next[moduleId];
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      next[moduleId] = value;
    }
  }
  return Object.keys(next).length ? next : undefined;
}

export function validatedNewTask(input: TaskInput): Task {
  const start = normalizedDate(input.start, "Reminder start");
  const end = normalizedOptionalDate(input.end, "Reminder end");
  ensureEndAfterStart(start, end);
  const source = input.source ?? "local";
  const follows = source === "local" ? normalizedFollows(input.follows, undefined) : undefined;
  const repeat = source === "local" && !follows ? normalizedRepeat(input.repeat) : undefined;
  ensureRepeatWindow(start, end, repeat);

  const task: Task = {
    id: randomTaskId(),
    name: normalizedName(input.name),
    start,
    end,
    createdAt: new Date().toISOString(),
    repeat,
    follows,
    source,
    sourceId: input.sourceId,
    sourceCalendar: input.sourceCalendar,
    occurrenceDate: input.occurrenceDate,
    readOnly: input.readOnly ?? source !== "local",
    annoy: input.annoy === true ? true : undefined,
    moduleData: normalizedModuleData(input.moduleData),
  };

  return refreshedRepeatingTask(task, Date.now()).task;
}

export function validatedParsedTask(task: Task): Task {
  const start = normalizedDate(task.start, "Reminder start");
  const end = normalizedOptionalDate(task.end, "Reminder end");
  ensureEndAfterStart(start, end);
  const source = task.source ?? "local";
  const follows = source === "local" ? normalizedFollows(task.follows, task.id) : undefined;
  const repeat = source === "local" && !follows ? normalizedRepeat(task.repeat) : undefined;
  ensureRepeatWindow(start, end, repeat);

  const normalized: Task = {
    ...task,
    id: typeof task.id === "string" && task.id ? task.id : randomTaskId(),
    name: normalizedName(task.name),
    start,
    end,
    createdAt: task.createdAt ? normalizedDate(task.createdAt, "Reminder creation time") : new Date().toISOString(),
    dismissedAt: task.dismissedAt ? normalizedDate(task.dismissedAt, "Reminder dismissal time") : undefined,
    alertDismissedAt: task.alertDismissedAt ? normalizedDate(task.alertDismissedAt, "Reminder alert dismissal time") : undefined,
    alertDismissedFor: typeof task.alertDismissedFor === "string" && task.alertDismissedFor.trim()
      ? task.alertDismissedFor.trim()
      : undefined,
    alertChimedFor: typeof task.alertChimedFor === "string" && task.alertChimedFor.trim()
      ? task.alertChimedFor.trim()
      : undefined,
    annoy: task.annoy === true ? true : undefined,
    moduleData: normalizedModuleData(task.moduleData),
    repeat,
    follows,
    source,
    readOnly: task.readOnly ?? source !== "local",
  };

  return refreshedRepeatingTask(normalized, Date.now()).task;
}
