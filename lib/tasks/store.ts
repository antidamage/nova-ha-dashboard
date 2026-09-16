// Sole owner of the task package's module state and disk I/O: the data path,
// the write queue, the wash-chime claim queue and the in-process undo journal.
// dismissTaskAlert and completeTask live here too, so that this is the only
// file in the package importing lib/dashboard-events (a second importer would
// add a second edge to the existing dashboard-events <-> tasks import cycle).
import { readDashboardPreferences } from "../preferences";
import { resolveOrbEntries } from "../orb-info/preferences";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { publishTaskDismiss, publishTasks } from "../dashboard-events";
import { reconcileReminderIcons } from "../reminder-icon-hook";
import { emitModuleEvent } from "../modules/runtime/hooks";
import type { Task } from "../types";
import { washReminder } from "../wash-reminder";
import { normalizedTask, validatedParsedTask } from "./normalize-model";
import { alertSessionKey, refreshedRepeatingTask, rescheduledFollowers, sortTasks } from "./schedule-model";
import type { TaskFile, TaskUndoRecord } from "./types";

export const TASKS_PATH = process.env.NOVA_DASHBOARD_TASKS ?? path.join(process.cwd(), "data", "dashboard-tasks.json");

export let writeQueue = Promise.resolve();

export async function readTaskFile(): Promise<Task[]> {
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

export async function writeTaskFile(tasks: Task[]): Promise<void> {
  await mkdir(path.dirname(TASKS_PATH), { recursive: true });
  const tempPath = `${TASKS_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ tasks: sortTasks(tasks) }, null, 2)}\n`, "utf8");
  await rename(tempPath, TASKS_PATH);
}

export async function mutateTasks<T>(mutator: (tasks: Task[]) => { tasks: Task[]; result: T }): Promise<T> {
  let nextTasks: Task[] = [];
  let result: T;
  let changed = true;

  const run = writeQueue.then(async () => {
    const current = await readTaskFile();
    const mutation = mutator(current);
    nextTasks = sortTasks(mutation.tasks);
    result = mutation.result;
    changed = JSON.stringify(current) !== JSON.stringify(nextTasks);
    if (changed) await writeTaskFile(nextTasks);
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  if (changed) publishTasks(nextTasks);
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

// Claims run strictly in call order. The preferences read used to happen before
// the claim joined the task write queue, so two concurrent claims could enter
// that queue in either order and the later caller could win the chime.
export let washChimeClaimQueue: Promise<unknown> = Promise.resolve();

export function claimWashChime(id: string): Promise<boolean> {
  const run = washChimeClaimQueue.then(() => claimWashChimeInOrder(id));
  washChimeClaimQueue = run.catch(() => undefined);
  return run;
}

export async function claimWashChimeInOrder(id: string): Promise<boolean> {
  const preferences = await readDashboardPreferences();
  const repeat = resolveOrbEntries(preferences.orbInfo).some((entry) => entry.moduleId === "washing");
  return mutateTasks((tasks) => {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task || washReminder(task)?.phase !== "active" || task.dismissedAt || task.alertDismissedAt) return { tasks, result: false };
    const session = alertSessionKey(task);
    const elapsed = Date.now() - Date.parse(task.start);
    const slot = Math.floor(elapsed / 30_000);
    const claim = repeat ? `${session}:orb:${slot}` : session;
    if (elapsed < 0 || (repeat && elapsed >= 300_000) || task.alertChimedFor === claim || (!repeat && task.alertChimedFor?.startsWith(session))) return { tasks, result: false };
    return { tasks: tasks.map((candidate) => candidate.id === id ? { ...candidate, alertChimedFor: claim } : candidate), result: true };
  });
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

export const undoJournal = new Map<string, TaskUndoRecord>();

export function pruneUndoJournal(nowMs: number, windowMs: number) {
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
  const { task, snapshot, followerSnapshots } = await mutateTasks((tasks) => {
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
    const followerSnapshots = tasks.filter((candidate) => candidate.follows?.taskId === id);
    const nextTasks = rescheduledFollowers(
      tasks.map((candidate) => (candidate.id === id ? updated : candidate)),
      id,
      nowMs,
    );

    return {
      tasks: nextTasks,
      result: { task: updated, snapshot, followerSnapshots },
    };
  });

  undoJournal.set(id, { task: snapshot, followers: followerSnapshots, completedAt: nowMs });

  publishTaskDismiss(id);
  emitModuleEvent({
    id: "reminder.completed",
    at: dismissedAt,
    source: "server",
    task: { id, name: snapshot.name, moduleData: snapshot.moduleData },
  });
  return task;
}
