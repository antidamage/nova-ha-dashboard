import type { Task, TaskFollows, TaskRepeat, TaskSource } from "../../../lib/types";

export type TaskTab = "today" | "upcoming";
/**
 * The editor's schedule modes. `after` is not a `TaskRepeat` — it produces a
 * `follows` link instead — but it belongs in the same picker because it answers
 * the same question: when does this come back?
 */
export type TaskRepeatDraftKind = TaskRepeat["kind"] | "after";

// Day repeats are measured from completion, so a few clear days is the useful
// default rather than "back tomorrow".
export const DEFAULT_REPEAT_DAYS = 3;
// A follow-on is nearly always "the day after", and evening is the half of the
// day the 7am day-repeat return does not already cover.
export const DEFAULT_FOLLOW_OFFSET_DAYS = 1;
export const DEFAULT_FOLLOW_HOUR = 18;

export type TaskDraft = {
  name: string;
  start: string;
  end: string;
  hasEnd: boolean;
  repeatEnabled: boolean;
  repeatKind: TaskRepeatDraftKind;
  repeatDays: string;
  followTaskId: string;
  followOffsetDays: string;
  followHour: string;
  annoy: boolean;
  /** Per-module state carried through the editor, keyed by module id. */
  moduleData?: Record<string, unknown>;
};

export type AlertState = {
  taskId: string;
  name: string;
  end?: string;
};

export type TaskEditorSaveDraft = {
  name: string;
  start: string;
  end?: string | null;
  repeat: TaskRepeat | null;
  follows: TaskFollows | null;
  annoy: boolean;
  moduleData?: Record<string, unknown>;
};

const TASK_TIME_FORMATTER = new Intl.DateTimeFormat("en-NZ", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function localInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function isoToLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return localInputValue(date);
}

export function localInputToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function fallbackEndInput(startInput: string) {
  const start = localInputToIso(startInput);
  const startDate = start ? new Date(start) : new Date();
  return localInputValue(new Date(startDate.getTime() + 30 * 60 * 1000));
}

export function defaultDraft(): TaskDraft {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 5);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    name: "",
    start: localInputValue(start),
    end: localInputValue(end),
    hasEnd: true,
    repeatEnabled: false,
    repeatKind: "days",
    repeatDays: String(DEFAULT_REPEAT_DAYS),
    followTaskId: "",
    followOffsetDays: String(DEFAULT_FOLLOW_OFFSET_DAYS),
    followHour: String(DEFAULT_FOLLOW_HOUR),
    annoy: false,
  };
}

export function taskDraft(task: Task): TaskDraft {
  const start = isoToLocalInput(task.start);

  return {
    name: task.name,
    start,
    end: task.end ? isoToLocalInput(task.end) : fallbackEndInput(start),
    hasEnd: Boolean(task.end),
    repeatEnabled: Boolean(task.repeat) || Boolean(task.follows),
    repeatKind: task.follows ? "after" : (task.repeat?.kind ?? "days"),
    repeatDays: task.repeat?.kind === "days" ? String(task.repeat.intervalDays) : String(DEFAULT_REPEAT_DAYS),
    followTaskId: task.follows?.taskId ?? "",
    followOffsetDays: String(task.follows?.offsetDays ?? DEFAULT_FOLLOW_OFFSET_DAYS),
    followHour: String(task.follows?.hour ?? DEFAULT_FOLLOW_HOUR),
    annoy: task.annoy === true,
    moduleData: task.moduleData,
  };
}

export function draftRepeat(draft: TaskDraft): TaskRepeat | null {
  if (!draft.repeatEnabled) {
    return null;
  }
  if (draft.repeatKind === "hourly") {
    return { kind: "hourly" };
  }
  if (draft.repeatKind === "morning-night") {
    return { kind: "morning-night" };
  }
  if (draft.repeatKind === "days") {
    return { kind: "days", intervalDays: Number(draft.repeatDays) };
  }
  return null;
}

export function draftFollows(draft: TaskDraft): TaskFollows | null {
  if (!draft.repeatEnabled || draft.repeatKind !== "after" || !draft.followTaskId) {
    return null;
  }

  return {
    taskId: draft.followTaskId,
    offsetDays: Number(draft.followOffsetDays),
    hour: Number(draft.followHour),
  };
}

export function repeatLabel(repeat: TaskRepeat | undefined) {
  if (!repeat) {
    return null;
  }
  if (repeat.kind === "hourly") {
    return "Repeats hourly";
  }
  if (repeat.kind === "morning-night") {
    return "Repeats morning/night";
  }
  return `Repeats ${repeat.intervalDays} day${repeat.intervalDays === 1 ? "" : "s"} after completion`;
}

export function followsLabel(follows: TaskFollows | undefined, anchorName: string | undefined) {
  if (!follows) {
    return null;
  }

  const when =
    follows.offsetDays === 0
      ? "same day"
      : follows.offsetDays === 1
        ? "next day"
        : `${follows.offsetDays} days later`;

  return `Follows ${anchorName ?? "another reminder"} · ${when} ${String(follows.hour).padStart(2, "0")}:00`;
}

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
  const start = taskStartMs(task);
  return !taskHasEnd(task) && !isTaskComplete(task) && Number.isFinite(start) && start <= nowMs;
}

export function isTaskCurrent(task: Task, nowMs: number) {
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

export function timeRange(task: Task) {
  const start = TASK_TIME_FORMATTER.format(new Date(task.start));
  if (!task.end) {
    return `${start} reminder`;
  }

  return `${start} - ${TASK_TIME_FORMATTER.format(new Date(task.end))}`;
}

export function sourceLabel(source: TaskSource) {
  if (source === "icloud-calendar") {
    return "Calendar";
  }
  if (source === "icloud-reminders") {
    return "Reminder";
  }
  return "Local";
}

export function statusForTask(task: Task, nowMs: number) {
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

function repeatExportValue(repeat: TaskRepeat | undefined) {
  if (!repeat) {
    return "";
  }
  if (repeat.kind === "hourly") {
    return "hourly";
  }
  if (repeat.kind === "morning-night") {
    return "morning/night";
  }
  return `days:${repeat.intervalDays}`;
}

function exportDateTime(value: string | undefined) {
  if (!value) {
    return "";
  }

  return localInputValue(new Date(value)).replace("T", " ");
}

export function tasksToExportText(tasks: Task[]) {
  return [
    "# start,end,name,repeat",
    ...tasks
      .filter((task) => task.source === "local")
      .sort((left, right) => taskStartMs(left) - taskStartMs(right))
      .map((task) =>
        [
          exportDateTime(task.start),
          exportDateTime(task.end),
          task.name.replaceAll(",", " "),
          repeatExportValue(task.repeat),
        ].join(","),
      ),
  ].join("\n");
}
