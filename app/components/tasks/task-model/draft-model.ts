import type { Task, TaskFollows, TaskRepeat } from "../../../../lib/types";
import type { TaskDraft } from "./types";

// Day repeats are measured from completion, so a few clear days is the useful
// default rather than "back tomorrow".
export const DEFAULT_REPEAT_DAYS = 3;
// A follow-on is nearly always "the day after", and evening is the half of the
// day the 7am day-repeat return does not already cover.
export const DEFAULT_FOLLOW_OFFSET_DAYS = 1;
export const DEFAULT_FOLLOW_HOUR = 18;

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
