import type { Task, TaskFollows, TaskRepeat, TaskSource } from "../../../../lib/types";
import { washReminder } from "../../../../lib/wash-reminder";
import { localInputValue } from "./draft-model";
import { taskStartMs } from "./status-model";

const TASK_TIME_FORMATTER = new Intl.DateTimeFormat("en-NZ", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

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

export function timeRange(task: Task) {
  if (washReminder(task)?.phase === "waiting") return "Waiting for washing machine";
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
