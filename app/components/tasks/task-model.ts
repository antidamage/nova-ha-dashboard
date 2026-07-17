import type { Task, TaskRepeat, TaskSource } from "../../../lib/types";

export type TaskTab = "today" | "upcoming";
export type TaskRepeatDraftKind = TaskRepeat["kind"];

export type TaskDraft = {
  name: string;
  start: string;
  end: string;
  hasEnd: boolean;
  repeatEnabled: boolean;
  repeatKind: TaskRepeatDraftKind;
  repeatDays: string;
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
    repeatDays: "1",
  };
}

export function taskDraft(task: Task): TaskDraft {
  const start = isoToLocalInput(task.start);

  return {
    name: task.name,
    start,
    end: task.end ? isoToLocalInput(task.end) : fallbackEndInput(start),
    hasEnd: Boolean(task.end),
    repeatEnabled: Boolean(task.repeat),
    repeatKind: task.repeat?.kind ?? "days",
    repeatDays: task.repeat?.kind === "days" ? String(task.repeat.intervalDays) : "1",
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
  return `Repeats every ${repeat.intervalDays} day${repeat.intervalDays === 1 ? "" : "s"}`;
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
