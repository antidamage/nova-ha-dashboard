// Creating, editing and deleting reminders. Every write goes through the
// store's queued mutateTasks.
import { assignReminderIcons, reconcileReminderIcons } from "../reminder-icon-hook";
import type { Task } from "../types";
import { washReminder, type WashReminder } from "../wash-reminder";
import {
  mergedModuleData,
  normalizedDate,
  normalizedFollows,
  normalizedName,
  normalizedOptionalDate,
  normalizedRepeat,
  validatedNewTask,
  validatedParsedTask,
} from "./normalize-model";
import { ensureEndAfterStart, ensureRepeatWindow, refreshedRepeatingTask } from "./schedule-model";
import { mutateTasks } from "./store";
import type { TaskInput, TaskPatch } from "./types";

/** Reconcile a device-owned reminder without reopening acknowledged occurrences. */
export async function syncWashReminder(id: string, name: string, start: string, wash: WashReminder | null) {
  return mutateTasks((tasks) => {
    const existing = tasks.find((task) => task.id === id);
    if (!wash) return { tasks: tasks.filter((task) => task.id !== id || washReminder(task)?.phase === "active"), result: null };
    if (existing?.dismissedAt || existing?.alertDismissedAt) return { tasks, result: existing };
    const task: Task = {
      ...(existing ?? { id, createdAt: new Date().toISOString(), source: "local" as const }),
      name, start, annoy: false,
      moduleData: { "washing-machine": wash, "discord-bot": { onDue: false, onComplete: false } },
    };
    return { tasks: [...tasks.filter((candidate) => candidate.id !== id), task], result: task };
  });
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
    const hasFollowsPatch = Object.prototype.hasOwnProperty.call(patch, "follows");
    const hasRepeatPatch = Object.prototype.hasOwnProperty.call(patch, "repeat");
    const patchedFollows = hasFollowsPatch ? normalizedFollows(patch.follows, id) : current.follows;
    const patchedRepeat = hasRepeatPatch ? normalizedRepeat(patch.repeat) : current.repeat;
    // A follow-on takes its cadence from its anchor, so the two are exclusive:
    // setting one clears the other rather than leaving both to fight over
    // `start`.
    const follows = hasRepeatPatch && patchedRepeat && !hasFollowsPatch ? undefined : patchedFollows;
    const repeat = follows ? undefined : patchedRepeat;
    if (follows && !tasks.some((candidate) => candidate.id === follows.taskId)) {
      throw new Error("The reminder this one follows no longer exists");
    }
    ensureRepeatWindow(start, end, repeat);
    const hasAnnoyPatch = Object.prototype.hasOwnProperty.call(patch, "annoy");
    const annoy = hasAnnoyPatch ? (patch.annoy === true ? true : undefined) : current.annoy;
    // Merged per module id, never replaced wholesale: a partial write from one
    // module's UI must not wipe another module's settings on the same reminder.
    const moduleData = Object.prototype.hasOwnProperty.call(patch, "moduleData")
      ? mergedModuleData(current.moduleData, patch.moduleData)
      : current.moduleData;
    const sameOccurrence = start === current.start && end === current.end;

    const updated: Task = refreshedRepeatingTask({
      ...current,
      name: patch.name === undefined ? current.name : normalizedName(patch.name),
      start,
      end,
      repeat,
      follows,
      annoy,
      moduleData,
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
    // Deleting an anchor leaves its followers with nothing to be scheduled
    // from, so they revert to plain one-off reminders sitting at whatever their
    // last occurrence was, rather than keeping a link that can never fire again.
    const nextTasks = tasks
      .filter((task) => !idSet.has(task.id))
      .map((task) => (task.follows && idSet.has(task.follows.taskId) ? { ...task, follows: undefined } : task));
    return { tasks: nextTasks, result: nextTasks };
  });

  // A delete is an authoritative removal, so also forget its presentation
  // metadata. The bar additionally filters against live tasks for immediate
  // correctness while this asynchronous reconciliation finishes.
  reconcileReminderIcons(remaining);
}

/**
 * Attach per-module state to a reminder.
 *
 * Deliberately separate from `updateTask`, which refuses mirrored reminders:
 * this is dashboard-local state about a reminder, not a change to the reminder
 * itself, so an iCloud mirror can carry it without the dashboard pretending it
 * owns the upstream item.
 */
export async function setTaskModuleData(
  id: string,
  moduleId: string,
  value: Record<string, unknown> | null,
): Promise<Task> {
  return mutateTasks((tasks) => {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }
    const current = tasks[index];
    const updated: Task = {
      ...current,
      moduleData: mergedModuleData(current.moduleData, { [moduleId]: value }),
    };
    return {
      tasks: tasks.map((task) => (task.id === id ? updated : task)),
      result: updated,
    };
  });
}
