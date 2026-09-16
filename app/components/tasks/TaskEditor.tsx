import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ReminderGlyph } from "../../../lib/reminder-glyph";
import type { Task } from "../../../lib/types";
import { ModuleSlot } from "../modules/ModuleSlot";
import { ReminderGlyphMark, reminderGlyphLabel } from "../reminders/icon-registry";
import { ReminderIconPicker } from "../reminders/ReminderIconPicker";
import { FOLLOW_HOURS, inputClassName, repeatOptions } from "./constants";
import { rosterGlyphFor, type RosterGlyphs } from "./reminder-roster-client";
import { TaskCheckbox } from "./TaskCheckbox";
import {
  draftFollows,
  draftRepeat,
  fallbackEndInput,
  localInputToIso,
  type TaskDraft,
  type TaskEditorSaveDraft,
  type TaskRepeatDraftKind,
} from "./task-model";

export function TaskEditor({
  anchorOptions,
  busy,
  initial,
  onCancel,
  onSave,
  rosterGlyphs,
  submitLabel,
}: {
  /** Reminders this one may be scheduled from — local ones, never itself. */
  anchorOptions: Task[];
  busy: boolean;
  initial: TaskDraft;
  onCancel: () => void;
  /** `glyph` is the icon picked in this editor, or null when none was. */
  onSave: (draft: TaskEditorSaveDraft, glyph: ReminderGlyph | null) => Promise<void>;
  /** The reminder roster's glyphs, keyed by normalised name. */
  rosterGlyphs: RosterGlyphs;
  submitLabel: string;
}) {
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [chosenGlyph, setChosenGlyph] = useState<ReminderGlyph | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Until one is picked, the icon shown is the roster's for the name as it stood.
  const glyph = chosenGlyph ?? rosterGlyphFor(rosterGlyphs, initial.name);

  useEffect(() => {
    setDraft(initial);
    setError(null);
  }, [
    initial.annoy,
    initial.end,
    initial.hasEnd,
    initial.name,
    initial.repeatDays,
    initial.repeatEnabled,
    initial.repeatKind,
    initial.followTaskId,
    initial.followOffsetDays,
    initial.followHour,
    initial.start,
  ]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = localInputToIso(draft.start);
    const end = draft.hasEnd ? localInputToIso(draft.end) : null;

    if (!draft.name.trim()) {
      setError("Reminder name is required");
      return;
    }
    if (!start) {
      setError("Start is required");
      return;
    }
    if (draft.hasEnd && !end) {
      setError("End is required");
      return;
    }
    if (end && new Date(end).getTime() <= new Date(start).getTime()) {
      setError("End must be after start");
      return;
    }
    if (draft.repeatEnabled && draft.repeatKind === "days") {
      const repeatDays = Number(draft.repeatDays);
      if (!Number.isInteger(repeatDays) || repeatDays < 1 || repeatDays > 365) {
        setError("Repeat days must be between 1 and 365");
        return;
      }
    }
    if (draft.repeatEnabled && draft.repeatKind === "after") {
      if (!draft.followTaskId) {
        setError("Choose the reminder this one follows");
        return;
      }
      const offsetDays = Number(draft.followOffsetDays);
      if (!Number.isInteger(offsetDays) || offsetDays < 0 || offsetDays > 365) {
        setError("Follow-on offset must be between 0 and 365 days");
        return;
      }
    }

    setError(null);
    await onSave({
      name: draft.name.trim(),
      start,
      end,
      repeat: draftRepeat(draft),
      follows: draftFollows(draft),
      annoy: draft.annoy,
      moduleData: draft.moduleData,
    }, chosenGlyph);
  };

  return (
    <form className="task-inline-editor grid gap-3 border border-neutral-700 bg-neutral-950/70 p-3" onSubmit={submit}>
      <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
        Name
        <input
          className={inputClassName}
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
      </label>
      <div className="grid gap-1 text-xs font-black uppercase text-neutral-400">
        <span id="task-editor-icon-label">Icon</span>
        <button
          aria-describedby="task-editor-icon-label"
          aria-label={`Icon: ${reminderGlyphLabel(glyph)}`}
          className="task-editor-icon inline-flex h-11 w-11 items-center justify-center border border-neutral-700 text-neutral-100"
          type="button"
          onClick={() => setPickerOpen(true)}
        >
          <ReminderGlyphMark glyph={glyph} />
        </button>
        <ReminderIconPicker
          glyph={glyph}
          open={pickerOpen}
          reminderName={draft.name.trim() || "new reminder"}
          onClose={() => setPickerOpen(false)}
          onSelect={(next) => {
            setChosenGlyph(next);
            setPickerOpen(false);
          }}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
          Start
          <input
            className={inputClassName}
            type="datetime-local"
            value={draft.start}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                start: event.target.value,
                end: current.hasEnd && !current.end ? fallbackEndInput(event.target.value) : current.end,
              }))
            }
          />
        </label>
        <div className="grid gap-2">
          <TaskCheckbox
            checked={draft.hasEnd}
            label="Reminder end"
            onChange={(hasEnd) =>
              setDraft((current) => ({
                ...current,
                hasEnd,
                end: current.end || fallbackEndInput(current.start),
              }))
            }
          />
          {draft.hasEnd ? (
            <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
              End
              <input
                className={inputClassName}
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))}
              />
            </label>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3">
        <TaskCheckbox
          checked={draft.repeatEnabled}
          label="Repeating"
          onChange={(repeatEnabled) => setDraft((current) => ({ ...current, repeatEnabled }))}
        />
        <TaskCheckbox
          checked={draft.annoy}
          label="Keep chiming until dismissed"
          onChange={(annoy) => setDraft((current) => ({ ...current, annoy }))}
        />
        {draft.repeatEnabled ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.45fr)]">
            <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
              Repeat
              <select
                className={inputClassName}
                value={draft.repeatKind}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    repeatKind: event.target.value as TaskRepeatDraftKind,
                  }))
                }
              >
                {repeatOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {draft.repeatKind === "days" ? (
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                Days · returns 7am
                <input
                  className={inputClassName}
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={draft.repeatDays}
                  onChange={(event) => setDraft((current) => ({ ...current, repeatDays: event.target.value }))}
                />
              </label>
            ) : null}
            {draft.repeatKind === "after" ? (
              <>
                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  Follows
                  <select
                    className={inputClassName}
                    value={draft.followTaskId}
                    onChange={(event) => setDraft((current) => ({ ...current, followTaskId: event.target.value }))}
                  >
                    <option value="">Choose a reminder</option>
                    {anchorOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  Days after
                  <input
                    className={inputClassName}
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    value={draft.followOffsetDays}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, followOffsetDays: event.target.value }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  At
                  <select
                    className={inputClassName}
                    value={draft.followHour}
                    onChange={(event) => setDraft((current) => ({ ...current, followHour: event.target.value }))}
                  >
                    {FOLLOW_HOURS.map((hour) => (
                      <option key={hour} value={String(hour)}>
                        {`${String(hour).padStart(2, "0")}:00`}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <ModuleSlot
        id="reminder.editor.fields"
        context={{
          moduleData: draft.moduleData ?? {},
          setModuleData: (moduleId: string, value: Record<string, unknown> | null) =>
            setDraft((current) => {
              const next = { ...(current.moduleData ?? {}) };
              if (value === null) {
                delete next[moduleId];
              } else {
                next[moduleId] = value;
              }
              return { ...current, moduleData: next };
            }),
        }}
      />
      {error ? <p className="text-sm font-black uppercase text-red-400">{error}</p> : null}
      <div className="task-editor-actions flex flex-wrap justify-end gap-2">
        <button
          className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-4 py-2 text-sm font-black"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
        <button
          className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
          type="submit"
          disabled={busy}
        >
          <Check className="h-4 w-4" />
          {busy ? "Saving" : submitLabel}
        </button>
      </div>
    </form>
  );
}
