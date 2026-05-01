import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { publishTaskDismiss, publishTasks } from "./dashboard-events";
import { parseTaskCsv } from "./parse-task-csv";
import type { Task, TaskRepeat, TaskSource } from "./types";

export { parseTaskCsv };
export type { ParseTaskCsvError, ParseTaskCsvResult } from "./parse-task-csv";

const TASKS_PATH = process.env.NOVA_DASHBOARD_TASKS ?? path.join(process.cwd(), "data", "dashboard-tasks.json");

type TaskFile = {
  tasks?: unknown;
};

type TaskInput = {
  name: unknown;
  start: unknown;
  end?: unknown;
  repeat?: unknown;
  source?: TaskSource;
  sourceId?: string;
  sourceCalendar?: string;
  occurrenceDate?: string;
  readOnly?: boolean;
};

type TaskPatch = Partial<{
  name: unknown;
  start: unknown;
  end: unknown;
  repeat: unknown;
}>;

let writeQueue = Promise.resolve();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_REPEAT_DAYS = 1;
const MAX_REPEAT_DAYS = 365;

function randomTaskId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedDate(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} is invalid`);
  }

  return date.toISOString();
}

function normalizedOptionalDate(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && !value.trim()) {
    return undefined;
  }

  return normalizedDate(value, fieldName);
}

function normalizedName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Task name is required");
  }

  return value.trim();
}

function normalizedRepeat(value: unknown): TaskRepeat | undefined {
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

function repeatIntervalMs(repeat: TaskRepeat) {
  if (repeat.kind === "hourly") {
    return HOUR_MS;
  }
  if (repeat.kind === "morning-night") {
    return 12 * HOUR_MS;
  }
  return repeat.intervalDays * DAY_MS;
}

function ensureEndAfterStart(start: string, end: string | undefined) {
  if (!end) {
    return;
  }

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error("Task end must be after task start");
  }
}

function ensureRepeatWindow(start: string, end: string | undefined, repeat: TaskRepeat | undefined) {
  if (!repeat || !end) {
    return;
  }

  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (durationMs >= repeatIntervalMs(repeat)) {
    throw new Error("Task duration must be shorter than the repeat interval");
  }
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const byStart = new Date(left.start).getTime() - new Date(right.start).getTime();
    return byStart || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

function nextIntervalStart(start: string, durationMs: number, repeat: TaskRepeat, nowMs: number) {
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) {
    return null;
  }

  if (repeat.kind !== "days") {
    const intervalMs = repeatIntervalMs(repeat);
    const elapsedAfterEnd = nowMs - (startMs + durationMs);
    const steps = Math.max(1, Math.floor(elapsedAfterEnd / intervalMs) + 1);
    return new Date(startMs + steps * intervalMs);
  }

  let next = new Date(start);
  const elapsedAfterEnd = nowMs - (startMs + durationMs);
  const roughSteps = Math.max(1, Math.floor(elapsedAfterEnd / repeatIntervalMs(repeat)) + 1);
  next.setDate(next.getDate() + roughSteps * repeat.intervalDays);

  while (next.getTime() + durationMs <= nowMs) {
    next.setDate(next.getDate() + repeat.intervalDays);
  }

  return next;
}

function refreshedRepeatingTask(task: Task, nowMs: number) {
  if (!task.repeat || task.source !== "local") {
    return { task, changed: false };
  }

  const startMs = new Date(task.start).getTime();
  const hasEnd = typeof task.end === "string" && task.end.trim().length > 0;
  const endMs = hasEnd ? new Date(task.end as string).getTime() : startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { task, changed: false };
  }

  const completed = Boolean(task.dismissedAt) && nowMs >= startMs;
  if (!completed && nowMs < endMs) {
    return { task, changed: false };
  }

  if (!hasEnd && !completed) {
    return { task, changed: false };
  }

  const durationMs = endMs - startMs;
  const nextStart = nextIntervalStart(task.start, durationMs, task.repeat, nowMs);
  if (!nextStart) {
    return { task, changed: false };
  }

  const updated: Task = {
    ...task,
    start: nextStart.toISOString(),
    end: hasEnd ? new Date(nextStart.getTime() + durationMs).toISOString() : undefined,
    dismissedAt: undefined,
  };

  return { task: updated, changed: true };
}

function normalizedTask(value: unknown): Task | null {
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

  const start = normalizedDate(candidate.start, "Task start");
  const end = normalizedOptionalDate(candidate.end, "Task end");
  const repeat = source === "local" ? normalizedRepeat(candidate.repeat) : undefined;
  ensureEndAfterStart(start, end);
  ensureRepeatWindow(start, end, repeat);

  return {
    id: candidate.id,
    name: candidate.name,
    start,
    end,
    createdAt: normalizedDate(candidate.createdAt, "Task creation time"),
    dismissedAt: candidate.dismissedAt ? normalizedDate(candidate.dismissedAt, "Task dismissal time") : undefined,
    repeat,
    source,
    sourceId: candidate.sourceId,
    sourceCalendar: candidate.sourceCalendar,
    occurrenceDate: candidate.occurrenceDate,
    readOnly: candidate.readOnly ?? source !== "local",
  };
}

async function readTaskFile(): Promise<Task[]> {
  try {
    const data = JSON.parse(await readFile(TASKS_PATH, "utf8")) as TaskFile;
    if (!Array.isArray(data.tasks)) {
      return [];
    }

    return sortTasks(data.tasks.flatMap((task) => {
      const normalized = normalizedTask(task);
      return normalized ? [normalized] : [];
    }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeTaskFile(tasks: Task[]): Promise<void> {
  await mkdir(path.dirname(TASKS_PATH), { recursive: true });
  const tempPath = `${TASKS_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ tasks: sortTasks(tasks) }, null, 2)}\n`, "utf8");
  await rename(tempPath, TASKS_PATH);
}

function validatedNewTask(input: TaskInput): Task {
  const start = normalizedDate(input.start, "Task start");
  const end = normalizedOptionalDate(input.end, "Task end");
  ensureEndAfterStart(start, end);
  const source = input.source ?? "local";
  const repeat = source === "local" ? normalizedRepeat(input.repeat) : undefined;
  ensureRepeatWindow(start, end, repeat);

  const task: Task = {
    id: randomTaskId(),
    name: normalizedName(input.name),
    start,
    end,
    createdAt: new Date().toISOString(),
    repeat,
    source,
    sourceId: input.sourceId,
    sourceCalendar: input.sourceCalendar,
    occurrenceDate: input.occurrenceDate,
    readOnly: input.readOnly ?? source !== "local",
  };

  return refreshedRepeatingTask(task, Date.now()).task;
}

function validatedParsedTask(task: Task): Task {
  const start = normalizedDate(task.start, "Task start");
  const end = normalizedOptionalDate(task.end, "Task end");
  ensureEndAfterStart(start, end);
  const source = task.source ?? "local";
  const repeat = source === "local" ? normalizedRepeat(task.repeat) : undefined;
  ensureRepeatWindow(start, end, repeat);

  const normalized: Task = {
    ...task,
    id: typeof task.id === "string" && task.id ? task.id : randomTaskId(),
    name: normalizedName(task.name),
    start,
    end,
    createdAt: task.createdAt ? normalizedDate(task.createdAt, "Task creation time") : new Date().toISOString(),
    dismissedAt: task.dismissedAt ? normalizedDate(task.dismissedAt, "Task dismissal time") : undefined,
    repeat,
    source,
    readOnly: task.readOnly ?? source !== "local",
  };

  return refreshedRepeatingTask(normalized, Date.now()).task;
}

async function mutateTasks<T>(mutator: (tasks: Task[]) => { tasks: Task[]; result: T }): Promise<T> {
  let nextTasks: Task[] = [];
  let result: T;

  const run = writeQueue.then(async () => {
    const current = await readTaskFile();
    const mutation = mutator(current);
    nextTasks = sortTasks(mutation.tasks);
    result = mutation.result;
    await writeTaskFile(nextTasks);
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  publishTasks(nextTasks);
  return result!;
}

export async function readTasks(): Promise<Task[]> {
  let nextTasks: Task[] = [];
  let changed = false;

  const run = writeQueue.then(async () => {
    const current = await readTaskFile();
    const refreshed = current.map((task) => {
      const result = refreshedRepeatingTask(task, Date.now());
      changed ||= result.changed;
      return result.task;
    });
    nextTasks = changed ? sortTasks(refreshed) : current;
    if (changed) {
      await writeTaskFile(nextTasks);
    }
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  if (changed) {
    publishTasks(nextTasks);
  }

  return nextTasks;
}

export async function writeTasks(tasks: Task[]): Promise<void> {
  const normalized = sortTasks(tasks.map(validatedParsedTask));
  const run = writeQueue.then(() => writeTaskFile(normalized));
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  publishTasks(normalized);
}

export async function addTask(input: TaskInput): Promise<Task> {
  const task = validatedNewTask(input);

  return mutateTasks((tasks) => ({
    tasks: [...tasks, task],
    result: task,
  }));
}

export async function addTasks(inputs: Task[]): Promise<Task[]> {
  const created = inputs.map(validatedParsedTask);

  if (!created.length) {
    return [];
  }

  return mutateTasks((tasks) => ({
    tasks: [...tasks, ...created],
    result: created,
  }));
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  return mutateTasks((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new Error("Task not found");
    }

    const current = tasks[index];
    if (current.readOnly || current.source !== "local") {
      throw new Error("Mirrored tasks are read-only");
    }

    const start = patch.start === undefined ? current.start : normalizedDate(patch.start, "Task start");
    const end = patch.end === undefined ? current.end : normalizedOptionalDate(patch.end, "Task end");
    ensureEndAfterStart(start, end);
    const hasRepeatPatch = Object.prototype.hasOwnProperty.call(patch, "repeat");
    const repeat = hasRepeatPatch ? normalizedRepeat(patch.repeat) : current.repeat;
    ensureRepeatWindow(start, end, repeat);

    const updated: Task = refreshedRepeatingTask({
      ...current,
      name: patch.name === undefined ? current.name : normalizedName(patch.name),
      start,
      end,
      repeat,
      dismissedAt: start === current.start && end === current.end ? current.dismissedAt : undefined,
    }, Date.now()).task;

    return {
      tasks: tasks.map((task) => (task.id === id ? updated : task)),
      result: updated,
    };
  });
}

export async function deleteTasks(ids: string[]): Promise<void> {
  const idSet = new Set(ids);

  await mutateTasks((tasks) => ({
    tasks: tasks.filter((task) => !idSet.has(task.id)),
    result: undefined,
  }));
}

export async function dismissTask(id: string): Promise<Task> {
  const dismissedAt = new Date().toISOString();
  const nowMs = Date.now();
  const task = await mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Task not found");
    }

    const dismissed = {
      ...tasks[index],
      dismissedAt,
    };
    const updated = refreshedRepeatingTask(dismissed, nowMs).task;

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? updated : candidate)),
      result: updated,
    };
  });

  publishTaskDismiss(id);
  return task;
}
