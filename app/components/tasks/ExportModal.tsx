import { X } from "lucide-react";
import { useMemo } from "react";
import type { Task } from "../../../lib/types";
import { tasksToExportText } from "./task-model";

export function ExportModal({
  onClose,
  open,
  tasks,
}: {
  onClose: () => void;
  open: boolean;
  tasks: Task[];
}) {
  const text = useMemo(() => tasksToExportText(tasks), [tasks]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="tasks-modal grid max-h-[92vh] w-full max-w-3xl gap-4 overflow-auto border border-neutral-700 bg-neutral-950 p-4 text-neutral-100">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black uppercase">Export reminders</h2>
            <p className="font-mono text-xs font-black uppercase text-neutral-500">start,end,name,repeat</p>
          </div>
          <button
            className="inline-flex h-11 w-11 items-center justify-center border border-neutral-700"
            type="button"
            onClick={onClose}
            aria-label="Close export"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <textarea
          className="min-h-80 w-full resize-y select-text border border-neutral-700 bg-neutral-950/70 p-3 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300"
          value={text}
          readOnly
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
    </div>
  );
}
