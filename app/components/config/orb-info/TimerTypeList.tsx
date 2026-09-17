"use client";

import { normalizeTimerIcons, type TimerIcon } from "../../../../lib/orb-timer-settings";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { ReminderGlyphMark } from "../../reminders/icon-registry";
import { ReminderIconPicker } from "../../reminders/ReminderIconPicker";

// The named timer types the orb's countdown rows draw their glyph from.
export function TimerTypeList({
  editingIcon,
  saveIcons,
  setEditingIcon,
  timerIcons,
}: {
  editingIcon: string | null;
  saveIcons: (timerIcons: TimerIcon[]) => void;
  setEditingIcon: (id: string | null) => void;
  timerIcons: ReturnType<typeof normalizeTimerIcons>;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-black uppercase">Timer types</p>
      {timerIcons.map((icon, index) => <div key={icon.id} className="flex items-center gap-2">
        <MomentaryFeedbackButton className="h-10 w-10" aria-label={`Choose ${icon.label} icon`} onClick={() => setEditingIcon(icon.id)}><ReminderGlyphMark glyph={icon.glyph} /></MomentaryFeedbackButton>
        <input aria-label="Timer type name" className="cyber-date-input" defaultValue={icon.label} key={`${icon.id}-${icon.label}`} onBlur={(event) => saveIcons(timerIcons.map((item) => item.id === icon.id ? { ...item, label: event.target.value.trim() || item.label } : item))} />
        <MomentaryFeedbackButton aria-label="Move timer type up" disabled={!index} onClick={() => { const next = [...timerIcons]; [next[index-1], next[index]] = [next[index], next[index-1]]; saveIcons(next); }}>Up</MomentaryFeedbackButton>
        <MomentaryFeedbackButton aria-label="Remove timer type" disabled={timerIcons.length === 1} onClick={() => saveIcons(timerIcons.filter((item) => item.id !== icon.id))}>Remove</MomentaryFeedbackButton>
        <ReminderIconPicker glyph={icon.glyph} open={editingIcon === icon.id} reminderName={icon.label} onClose={() => setEditingIcon(null)} onSelect={(glyph) => { saveIcons(timerIcons.map((item) => item.id === icon.id ? { ...item, glyph } : item)); setEditingIcon(null); }} />
      </div>)}
      <MomentaryFeedbackButton onClick={() => saveIcons([...timerIcons, { id: crypto.randomUUID(), label: "Timer", glyph: { kind: "phosphor", id: "timer" } }])}>Add timer type</MomentaryFeedbackButton>
    </div>
  );
}
