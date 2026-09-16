import { Plus } from "lucide-react";
import type { Task } from "../../../lib/types";
import { sourceLabel } from "./task-model";
import { TaskSourceIcon } from "./TaskSourceIcon";

export function ReadOnlyTaskPanel({
  busy,
  onConvert,
  task,
}: {
  busy: boolean;
  onConvert: (task: Task) => Promise<void>;
  task: Task;
}) {
  return (
    <div className="grid gap-3 border border-neutral-700 bg-neutral-950/70 p-3">
      <div className="grid gap-1 text-sm font-black uppercase text-neutral-300">
        <span className="text-neutral-500">Source</span>
        <span className="inline-flex items-center gap-2">
          <TaskSourceIcon task={task} />
          {sourceLabel(task.source)}
          {task.sourceCalendar ? <span className="text-neutral-500">/ {task.sourceCalendar}</span> : null}
        </span>
      </div>
      <button
        className="inline-flex min-h-11 w-max items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
        type="button"
        onClick={() => void onConvert(task)}
        disabled={busy}
      >
        <Plus className="h-4 w-4" />
        {busy ? "Converting" : "Convert to local"}
      </button>
    </div>
  );
}
