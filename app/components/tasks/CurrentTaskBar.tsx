import { Clock3 } from "lucide-react";
import type { Task } from "../../../lib/types";

export function CurrentTaskBar({ task }: { task: Task | null }) {
  if (!task) {
    return null;
  }

  return (
    <div
      className="current-task-bar"
      aria-live="polite"
      data-demo-tooltip-title="Reminder Bar"
      data-demo-tooltip="Shows the current active reminder."
    >
      <Clock3 className="h-4 w-4" />
      <span className="min-w-0 truncate">{task.name}</span>
    </div>
  );
}
