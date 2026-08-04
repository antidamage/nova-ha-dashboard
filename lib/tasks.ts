import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { publishTaskDismiss, publishTasks } from "./dashboard-events";
import { assignReminderIcons, reconcileReminderIcons } from "./reminder-icon-hook";
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
  annoy?: unknown;
};

type TaskPatch = Partial<{
  name: unknown;
  start: unknown;
  end: unknown;
  repeat: unknown;
  annoy: unknown;
}>;

let writeQueue = Promise.resolve();

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_REPEAT_DAYS = 1;
const MAX_REPEAT_DAYS = 365;
// Local hour a completed day-interval reminder comes back at.
const REPEAT_MORNING_HOUR = 7;

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
    throw new Error("Reminder name is required");
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

function alertSessionKey(task: Pick<Task, "start" | "end">) {
  return `${task.start}:${task.end ?? "reminder"}`;
}

function ensureEndAfterStart(start: string, end: string | undefined) {
  if (!end) {
    return;
  }

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error("Reminder end must be after reminder start");
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

/**
 * Where a day-interval reminder lands once it has actually been ticked off.
 *
 * Day repeats measure their gap from the completion, not from the schedule the
 * occurrence happened to sit on: "every three days" means three clear days
 * after doing the thing, so a chore ticked late does not come straight back.
 * The next occurrence is pinned to 7am so it is waiting on the panel first
 * thing that morning rather than at whatever minute the box was tapped.
 */
function nextCompletionAnchoredStart(
  dismissedAtMs: number,
  durationMs: number,
  intervalDays: number,
  nowMs: number,
) {
  const next = new Date(dismissedAtMs);
  next.setDate(next.getDate() + intervalDays);
  next.setHours(REPEAT_MORNING_HOUR, 0, 0, 0);

  while (next.getTime() + durationMs <= nowMs) {
    next.setDate(next.getDate() + intervalDays);
  }

  return next;
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

  const dismissedAtMs = task.dismissedAt ? new Date(task.dismissedAt).getTime() : NaN;
  if (task.repeat && task.dismissedAt && Number.isFinite(dismissedAtMs) && dismissedAtMs < startMs) {
    return {
      task: {
        ...task,
        dismissedAt: undefined,
      },
      changed: true,
    };
  }

  const completed = Boolean(task.dismissedAt) && nowMs >= startMs;
  if (!completed && nowMs < endMs) {
    return { task, changed: false };
  }

  if (!hasEnd && !completed) {
    return { task, changed: false };
  }

  const durationMs = endMs - startMs;
  const nextStart =
    completed && task.repeat.kind === "days" && Number.isFinite(dismissedAtMs)
      ? nextCompletionAnchoredStart(dismissedAtMs, durationMs, task.repeat.intervalDays, nowMs)
      : nextIntervalStart(task.start, durationMs, task.repeat, nowMs);
  if (!nextStart) {
    return { task, changed: false };
  }

  const updated: Task = {
    ...task,
    start: nextStart.toISOString(),
    end: hasEnd ? new Date(nextStart.getTime() + durationMs).toISOString() : undefined,
    dismissedAt: undefined,
    alertDismissedAt: undefined,
    alertDismissedFor: undefined,
    alertChimedFor: undefined,
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

  const start = normalizedDate(candidate.start, "Reminder start");
  const end = normalizedOptionalDate(candidate.end, "Reminder end");
  const repeat = source === "local" ? normalizedRepeat(candidate.repeat) : undefined;
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
    repeat,
    source,
    sourceId: candidate.sourceId,
    sourceCalendar: candidate.sourceCalendar,
    occurrenceDate: candidate.occurrenceDate,
    readOnly: candidate.readOnly ?? source !== "local",
    recurs: candidate.recurs === true ? true : undefined,
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
  const start = normalizedDate(input.start, "Reminder start");
  const end = normalizedOptionalDate(input.end, "Reminder end");
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
    annoy: input.annoy === true ? true : undefined,
  };

  return refreshedRepeatingTask(task, Date.now()).task;
}

function validatedParsedTask(task: Task): Task {
  const start = normalizedDate(task.start, "Reminder start");
  const end = normalizedOptionalDate(task.end, "Reminder end");
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
  reconcileReminderIcons(normalized);
}

export async function addTask(input: TaskInput): Promise<Task> {
  const task = validatedNewTask(input);

  const created = await mutateTasks((tasks) => ({
    tasks: [...tasks, task],
    result: task,
  }));

  assignReminderIcons([created]);
  return created;
}

export async function addTasks(inputs: Task[]): Promise<Task[]> {
  const created = inputs.map(validatedParsedTask);

  if (!created.length) {
    return [];
  }

  const added = await mutateTasks((tasks) => ({
    tasks: [...tasks, ...created],
    result: created,
  }));

  assignReminderIcons(added);
  return added;
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  return mutateTasks((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const current = tasks[index];
    if (current.readOnly || current.source !== "local") {
      throw new Error("Mirrored reminders are read-only");
    }

    const start = patch.start === undefined ? current.start : normalizedDate(patch.start, "Reminder start");
    const end = patch.end === undefined ? current.end : normalizedOptionalDate(patch.end, "Reminder end");
    ensureEndAfterStart(start, end);
    const hasRepeatPatch = Object.prototype.hasOwnProperty.call(patch, "repeat");
    const repeat = hasRepeatPatch ? normalizedRepeat(patch.repeat) : current.repeat;
    ensureRepeatWindow(start, end, repeat);
    const hasAnnoyPatch = Object.prototype.hasOwnProperty.call(patch, "annoy");
    const annoy = hasAnnoyPatch ? (patch.annoy === true ? true : undefined) : current.annoy;
    const sameOccurrence = start === current.start && end === current.end;

    const updated: Task = refreshedRepeatingTask({
      ...current,
      name: patch.name === undefined ? current.name : normalizedName(patch.name),
      start,
      end,
      repeat,
      annoy,
      dismissedAt: sameOccurrence ? current.dismissedAt : undefined,
      alertDismissedAt: sameOccurrence ? current.alertDismissedAt : undefined,
      alertDismissedFor: sameOccurrence ? current.alertDismissedFor : undefined,
      alertChimedFor: sameOccurrence ? current.alertChimedFor : undefined,
    }, Date.now()).task;

    return {
      tasks: tasks.map((task) => (task.id === id ? updated : task)),
      result: updated,
    };
  });
}

export async function deleteTasks(ids: string[]): Promise<void> {
  const idSet = new Set(ids);

  const remaining = await mutateTasks((tasks) => {
    const nextTasks = tasks.filter((task) => !idSet.has(task.id));
    return { tasks: nextTasks, result: nextTasks };
  });

  // A delete is an authoritative removal, so also forget its presentation
  // metadata. The bar additionally filters against live tasks for immediate
  // correctness while this asynchronous reconciliation finishes.
  reconcileReminderIcons(remaining);
}

export async function dismissTaskAlert(id: string): Promise<Task> {
  const alertDismissedAt = new Date().toISOString();
  const task = await mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const current = tasks[index];
    const dismissed: Task = {
      ...current,
      alertDismissedAt,
      alertDismissedFor: alertSessionKey(current),
      // Dismissing implies the chime is spent for this occurrence, even if the
      // sound never actually played (silenced screen, blocked autoplay).
      alertChimedFor: alertSessionKey(current),
    };

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? dismissed : candidate)),
      result: dismissed,
    };
  });

  publishTaskDismiss(id);
  return task;
}

/**
 * Record that this occurrence's chime has been played, so no other screen and
 * no later page load plays it again.
 *
 * Separate from `dismissTaskAlert` because the two are genuinely different
 * events: the banner may still be up, waiting to be tapped, long after the
 * sound has had its say. Idempotent -- concurrent screens racing to claim the
 * same occurrence all converge on the same key.
 */
export async function markTaskAlertChimed(id: string): Promise<Task> {
  return mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const current = tasks[index];
    const chimed: Task = { ...current, alertChimedFor: alertSessionKey(current) };

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? chimed : candidate)),
      result: chimed,
    };
  });
}

// Completions that can still be taken back.
//
// A snapshot is required rather than "just clear dismissedAt": completing a
// repeating task also rolls it forward to the next occurrence, so by the time
// the user wants their mis-tap back, the task they tapped no longer exists in
// that shape. The journal is in-process and deliberately unpersisted — an undo
// window is a few minutes of grace for a fat finger on a wall panel, not
// durable state worth surviving a restart.
type TaskUndoRecord = { task: Task; completedAt: number };

const undoJournal = new Map<string, TaskUndoRecord>();

function pruneUndoJournal(nowMs: number, windowMs: number) {
  for (const [id, record] of undoJournal) {
    if (record.completedAt <= nowMs - windowMs) {
      undoJournal.delete(id);
    }
  }
}

export function completedTaskUndoDeadline(id: string, windowMs: number): number | null {
  const record = undoJournal.get(id);
  if (!record) {
    return null;
  }

  const deadline = record.completedAt + windowMs;
  return deadline > Date.now() ? deadline : null;
}

export async function completeTask(id: string): Promise<Task> {
  const dismissedAt = new Date().toISOString();
  const nowMs = Date.now();
  const { task, snapshot } = await mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const snapshot = tasks[index];
    const dismissed = {
      ...snapshot,
      dismissedAt,
      alertDismissedAt: undefined,
      alertDismissedFor: undefined,
      alertChimedFor: undefined,
    };
    const updated = refreshedRepeatingTask(dismissed, nowMs).task;

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? updated : candidate)),
      result: { task: updated, snapshot },
    };
  });

  undoJournal.set(id, { task: snapshot, completedAt: nowMs });

  publishTaskDismiss(id);
  return task;
}

/**
 * Restore the pre-completion snapshot recorded by `completeTask`.
 *
 * Caveat worth knowing: a repeating task that HAS an end rolls itself forward
 * whenever it lapses, independently of completion, so restoring one will
 * simply roll forward again on the next read. Undo is meaningful for the
 * reminders it is actually offered on — end-less reminders and iCloud mirrors,
 * neither of which self-roll.
 */
export async function uncompleteTask(id: string, windowMs: number): Promise<Task> {
  const nowMs = Date.now();
  pruneUndoJournal(nowMs, windowMs);

  const record = undoJournal.get(id);
  if (!record) {
    throw new Error("That completion can no longer be undone");
  }

  const restored = await mutateTasks((tasks) => {
    const exists = tasks.some((candidate) => candidate.id === id);

    return {
      // The task is normally still present (completion mutates in place), but
      // a concurrent delete or an iCloud resync could have removed it; putting
      // the snapshot back is the honest interpretation of "undo" either way.
      tasks: exists
        ? tasks.map((candidate) => (candidate.id === id ? record.task : candidate))
        : [...tasks, record.task],
      result: record.task,
    };
  });

  undoJournal.delete(id);
  return restored;
}
