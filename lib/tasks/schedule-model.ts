// Pure scheduling model: where a repeating or follow-on reminder lands next,
// the ordering rule, and the start/end/repeat window checks. No I/O, no state.
import type { Task, TaskFollows, TaskRepeat } from "../types";
import { DAY_MS, HOUR_MS, REPEAT_MORNING_HOUR } from "./constants";

/**
 * Where a follow-on lands once its anchor has been ticked off: `offsetDays`
 * later, at its chosen hour, in local time. Deliberately date arithmetic rather
 * than a millisecond offset so a DST boundary between the two still leaves the
 * reminder at the hour that was asked for.
 */
export function followOnStart(anchorCompletedAtMs: number, follows: TaskFollows) {
  const next = new Date(anchorCompletedAtMs);
  next.setDate(next.getDate() + follows.offsetDays);
  next.setHours(follows.hour, 0, 0, 0);
  return next;
}

/**
 * Move every reminder that follows `anchorId` to its next occurrence.
 *
 * Called when the anchor is completed, so the follow-on is rescheduled and
 * un-completed in the same write — the point of the link is that confirming the
 * anchor refreshes it.
 */
export function rescheduledFollowers(tasks: Task[], anchorId: string, anchorCompletedAtMs: number) {
  return tasks.map((task) => {
    if (!task.follows || task.follows.taskId !== anchorId || task.source !== "local") {
      return task;
    }

    const start = followOnStart(anchorCompletedAtMs, task.follows);
    const startMs = new Date(task.start).getTime();
    const endMs = task.end ? new Date(task.end).getTime() : NaN;
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) ? endMs - startMs : 0;

    return {
      ...task,
      start: start.toISOString(),
      end: task.end && durationMs > 0 ? new Date(start.getTime() + durationMs).toISOString() : task.end,
      dismissedAt: undefined,
      alertDismissedAt: undefined,
      alertDismissedFor: undefined,
      alertChimedFor: undefined,
    } satisfies Task;
  });
}

export function repeatIntervalMs(repeat: TaskRepeat) {
  if (repeat.kind === "hourly") {
    return HOUR_MS;
  }
  if (repeat.kind === "morning-night") {
    return 12 * HOUR_MS;
  }
  return repeat.intervalDays * DAY_MS;
}

export function alertSessionKey(task: Pick<Task, "start" | "end">) {
  return `${task.start}:${task.end ?? "reminder"}`;
}

export function ensureEndAfterStart(start: string, end: string | undefined) {
  if (!end) {
    return;
  }

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error("Reminder end must be after reminder start");
  }
}

export function ensureRepeatWindow(start: string, end: string | undefined, repeat: TaskRepeat | undefined) {
  if (!repeat || !end) {
    return;
  }

  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (durationMs >= repeatIntervalMs(repeat)) {
    throw new Error("Task duration must be shorter than the repeat interval");
  }
}

export function sortTasks(tasks: Task[]) {
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
export function nextCompletionAnchoredStart(
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

export function nextIntervalStart(start: string, durationMs: number, repeat: TaskRepeat, nowMs: number) {
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

export function refreshedRepeatingTask(task: Task, nowMs: number) {
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
