import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { publishTaskDismiss, publishTasks } from "./dashboard-events";
import { parseTaskCsv } from "./parse-task-csv";
import type { Task, TaskSource } from "./types";

export { parseTaskCsv };
export type { ParseTaskCsvError, ParseTaskCsvResult } from "./parse-task-csv";

const TASKS_PATH = process.env.NOVA_DASHBOARD_TASKS ?? path.join(process.cwd(), "data", "dashboard-tasks.json");

type TaskFile = {
  tasks?: unknown;
};

type TaskInput = {
  name: unknown;
  start: unknown;
  end: unknown;
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
}>;

let writeQueue = Promise.resolve();

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

function normalizedName(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Task name is required");
  }

  return value.trim();
}

function ensureEndAfterStart(start: string, end: string) {
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error("Task end must be after task start");
  }
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const byStart = new Date(left.start).getTime() - new Date(right.start).getTime();
    return byStart || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
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
    typeof candidate.end !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  const source = candidate.source ?? "local";
  if (!["local", "icloud-calendar", "icloud-reminders"].includes(source)) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    start: normalizedDate(candidate.start, "Task start"),
    end: normalizedDate(candidate.end, "Task end"),
    createdAt: normalizedDate(candidate.createdAt, "Task creation time"),
    dismissedAt: candidate.dismissedAt ? normalizedDate(candidate.dismissedAt, "Task dismissal time") : undefined,
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
  const end = normalizedDate(input.end, "Task end");
  ensureEndAfterStart(start, end);

  const source = input.source ?? "local";

  return {
    id: randomTaskId(),
    name: normalizedName(input.name),
    start,
    end,
    createdAt: new Date().toISOString(),
    source,
    sourceId: input.sourceId,
    sourceCalendar: input.sourceCalendar,
    occurrenceDate: input.occurrenceDate,
    readOnly: input.readOnly ?? source !== "local",
  };
}

function validatedParsedTask(task: Task): Task {
  const start = normalizedDate(task.start, "Task start");
  const end = normalizedDate(task.end, "Task end");
  ensureEndAfterStart(start, end);
  const source = task.source ?? "local";

  return {
    ...task,
    id: typeof task.id === "string" && task.id ? task.id : randomTaskId(),
    name: normalizedName(task.name),
    start,
    end,
    createdAt: task.createdAt ? normalizedDate(task.createdAt, "Task creation time") : new Date().toISOString(),
    dismissedAt: task.dismissedAt ? normalizedDate(task.dismissedAt, "Task dismissal time") : undefined,
    source,
    readOnly: task.readOnly ?? source !== "local",
  };
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
  return readTaskFile();
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
    const end = patch.end === undefined ? current.end : normalizedDate(patch.end, "Task end");
    ensureEndAfterStart(start, end);

    const updated: Task = {
      ...current,
      name: patch.name === undefined ? current.name : normalizedName(patch.name),
      start,
      end,
      dismissedAt: start === current.start && end === current.end ? current.dismissedAt : undefined,
    };

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
  const task = await mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Task not found");
    }

    const updated = {
      ...tasks[index],
      dismissedAt,
    };

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? updated : candidate)),
      result: updated,
    };
  });

  publishTaskDismiss(id);
  return task;
}
