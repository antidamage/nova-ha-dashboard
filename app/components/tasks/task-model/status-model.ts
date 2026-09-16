import type { Task } from "../../../../lib/types";
import { washReminder } from "../../../../lib/wash-reminder";
import type { AlertState, TaskTab } from "./types";

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function taskStartMs(task: Task) {
  return new Date(task.start).getTime();
}

export function taskEndMs(task: Task) {
  return task.end ? new Date(task.end).getTime() : taskStartMs(task);
}

export function taskHasEnd(task: Task) {
  return typeof task.end === "string" && task.end.trim().length > 0;
}

export function taskAlertSessionKey(task: Pick<Task, "start" | "end">) {
  return `${task.start}:${task.end ?? "reminder"}`;
}

export function isTaskComplete(task: Task) {
  return Boolean(task.dismissedAt);
}

export function isTaskAlertSilenced(task: Task) {
  return task.alertDismissedFor === taskAlertSessionKey(task);
}

/**
 * Has this occurrence's chime already been played -- on this screen, on another
 * screen, or before the page was last reloaded?
 *
 * The alert itself outlives the sound: a banner keeps waiting for a tap, and
 * the reminder keeps its place in the icon bar. Only the audio is spent.
 */
export function hasTaskAlertChimed(task: Task) {
  return task.alertChimedFor === taskAlertSessionKey(task);
}

export function isTaskAnnoyer(task: Task) {
  return task.annoy === true;
}

export function isTaskActive(task: Task, nowMs: number) {
  if (!taskHasEnd(task) || isTaskComplete(task)) {
    return false;
  }

  const start = taskStartMs(task);
  const end = taskEndMs(task);
  return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
}

export function isTaskReminderDue(task: Task, nowMs: number) {
  if (washReminder(task)?.phase === "waiting") return false;
  const start = taskStartMs(task);
  return !taskHasEnd(task) && !isTaskComplete(task) && Number.isFinite(start) && start <= nowMs;
}

export function isTaskCurrent(task: Task, nowMs: number) {
  if (washReminder(task)?.phase === "waiting") return false;
  return isTaskActive(task, nowMs) || isTaskReminderDue(task, nowMs);
}

export function isTaskAlerting(task: Task, nowMs: number) {
  return !isTaskComplete(task) && !isTaskAlertSilenced(task) && isTaskCurrent(task, nowMs);
}

/**
 * Has this reminder been sitting unfinished for longer than `thresholdMs` past
 * the point it should have been done?
 *
 * Deliberately NOT part of `statusForTask`, which collapses everything past
 * its end into "Done" and is depended on by the reminders panel's status
 * chips. This is a separate axis used only by the icon bar's overdue pulse.
 *
 * Note which reminders can actually reach this state: a repeating LOCAL task
 * that has an end rolls itself forward once it lapses (tasks.ts
 * `refreshedRepeatingTask`), so it is never overdue — it is simply due again.
 * What does go overdue is the end-less reminder (local, repeating or not,
 * which is the "Due" case) and every iCloud mirror, since the roll-forward is
 * skipped for non-local sources.
 */
export function isTaskOverdue(task: Task, nowMs: number, thresholdMs: number) {
  if (washReminder(task)?.phase === "waiting") return false;
  if (isTaskComplete(task)) {
    return false;
  }

  const end = taskEndMs(task);
  return Number.isFinite(end) && end <= nowMs - thresholdMs;
}

export function shouldClearTaskAlert(tasks: Task[], alert: AlertState | null, nowMs: number) {
  if (!alert) {
    return false;
  }

  const task = tasks.find((candidate) => candidate.id === alert.taskId);
  return !task || !isTaskAlerting(task, nowMs);
}

export function taskVisibleInTab(task: Task, tab: TaskTab, nowMs: number) {
  if (isTaskCurrent(task, nowMs)) {
    return tab === "today";
  }

  const today = startOfLocalDay(new Date(nowMs));
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (taskEndMs(task) < today.getTime()) {
    return false;
  }

  const start = new Date(task.start);
  if (tab === "today") {
    return isSameLocalDay(start, today);
  }

  return taskStartMs(task) >= tomorrow.getTime();
}

export function statusForTask(task: Task, nowMs: number) {
  if (!isTaskComplete(task) && washReminder(task)?.phase === "waiting") return "Waiting";
  if (isTaskComplete(task)) {
    return "Done";
  }
  if (isTaskReminderDue(task, nowMs)) {
    return "Due";
  }
  if (taskEndMs(task) <= nowMs) {
    return "Done";
  }
  if (isTaskActive(task, nowMs)) {
    return "Active";
  }
  return "Upcoming";
}

export function statusClassName(status: string) {
  if (status === "Active") {
    return "border-cyan-300/50 bg-cyan-300/10 text-cyan-100";
  }
  if (status === "Due") {
    return "border-yellow-300/50 bg-yellow-300/10 text-yellow-100";
  }
  if (status === "Done") {
    return "border-neutral-600 bg-neutral-900/70 text-neutral-400";
  }
  return "border-emerald-300/50 bg-emerald-300/10 text-emerald-100";
}
