"use client";

import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";
import { isCountdownModule } from "../../../../lib/orb-info/stack";
import { orbModuleById } from "../../../../lib/orb-info/catalogue";
import type { OrbStackEntry } from "../../../../lib/orb-info/types";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { SlideSwitch } from "../../SlideSwitch";

// One row of the priority stack. Countdowns order themselves by time left, so
// they carry neither a drag handle nor the move buttons.
export function OrbEntryRow({
  dragId,
  entries,
  entry,
  entryEditor,
  index,
  moveEntry,
  saveEntries,
  selected,
  setDragId,
  setSelectedId,
}: {
  dragId: string | null;
  entries: OrbStackEntry[];
  entry: OrbStackEntry;
  entryEditor: ReactNode;
  index: number;
  moveEntry: (from: number, to: number) => void;
  saveEntries: (next: OrbStackEntry[]) => void;
  selected: OrbStackEntry | undefined;
  setDragId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
}) {
  const countdown = isCountdownModule(entry.moduleId);
  return <div className="grid gap-3" data-orb-entry-kind={countdown ? "countdown" : "ordered"}
    onDragOver={countdown ? undefined : (event) => event.preventDefault()}
    onDrop={countdown ? undefined : (event) => { event.preventDefault(); moveEntry(entries.findIndex((row) => row.id === dragId), index); setDragId(null); }}>
    <div className="flex items-center gap-2">
    {countdown
      ? <span className="config-icon-button text-xs font-black uppercase" title="Countdowns order by time left">Countdown</span>
      : <MomentaryFeedbackButton draggable onDragStart={() => setDragId(entry.id)} aria-label={`Drag ${orbModuleById(entry.moduleId).label}`} className="config-icon-button"><GripVertical size={18} /></MomentaryFeedbackButton>}
    <MomentaryFeedbackButton onClick={() => setSelectedId(selected?.id === entry.id ? "" : entry.id)} aria-expanded={selected?.id === entry.id} className="flex-1 text-left">{orbModuleById(entry.moduleId).label}</MomentaryFeedbackButton>
    {!countdown && <SlideSwitch label={`Enable ${orbModuleById(entry.moduleId).label}`} checked={entry.enabled !== false}
      onChange={() => saveEntries(entries.map((row) => row.id === entry.id ? { ...row, enabled: row.enabled === false } : row))} />}
    {!countdown && <MomentaryFeedbackButton aria-label="Move entry up" disabled={index === 0} onClick={() => moveEntry(index, index - 1)}><ArrowUp size={18} /></MomentaryFeedbackButton>}
    {!countdown && <MomentaryFeedbackButton aria-label="Move entry down" disabled={index === entries.length - 1} onClick={() => moveEntry(index, index + 1)}><ArrowDown size={18} /></MomentaryFeedbackButton>}
    <MomentaryFeedbackButton aria-label="Remove entry" onClick={() => saveEntries(entries.filter((row) => row.id !== entry.id))}><X size={18} /></MomentaryFeedbackButton>
    </div>
    {selected?.id === entry.id && entryEditor}
  </div>;
}
