"use client";

import {
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  ClipboardList,
  Clock3,
  Download,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceTheme } from "./accentColor";
import { resolveUxSoundUrl } from "./dashboard/controlSound";
import type { FormEvent } from "react";
import { parseTaskCsv, type ParseTaskCsvResult } from "../../lib/parse-task-csv";
import type { Task } from "../../lib/types";
import { washReminder } from "../../lib/wash-reminder";
import { useReminderBannerSetting } from "./dashboard/reminderBannerSetting";
import { loadSharedClientConfig, readCachedClientConfig } from "./sharedConfigCache";
import { subscribeToDashboardEvents } from "./sharedDashboardEvents";
import { jsonFetch } from "./tasks/task-api";
import { useModuleIntercepts } from "./modules/ModuleHost";
import { ModuleSlot } from "./modules/ModuleSlot";
import {
  defaultDraft,
  draftFollows,
  draftRepeat,
  fallbackEndInput,
  followsLabel,
  hasTaskAlertChimed,
  isTaskAlerting,
  isTaskAlertSilenced,
  isTaskAnnoyer,
  isTaskComplete,
  isTaskCurrent,
  localInputToIso,
  repeatLabel,
  shouldClearTaskAlert,
  sourceLabel,
  statusClassName,
  statusForTask,
  taskAlertSessionKey,
  taskDraft,
  taskStartMs,
  tasksToExportText,
  timeRange,
  type AlertState,
  type TaskDraft,
  type TaskEditorSaveDraft,
  type TaskRepeatDraftKind,
} from "./tasks/task-model";
import { useOrbSettings } from "./orb-info/useOrbSettings";
import { OrbCompletionAudio } from "./orb-info/OrbCompletionAudio";
import { TimerEncoder } from "./TimerEncoder";
import type { ReminderGlyph } from "../../lib/reminder-glyph";
import { ReminderGlyphMark, reminderGlyphLabel } from "./reminders/icon-registry";
import { ReminderIconPicker } from "./reminders/ReminderIconPicker";
import { TasksAdvanced } from "./tasks/TasksAdvanced";
import {
  glyphWriteForSave,
  loadRosterGlyphs,
  rosterGlyphFor,
  writeReminderGlyph,
  type RosterGlyphs,
} from "./tasks/reminder-roster-client";
import { AdvancedFold } from "./dashboard/AdvancedFold";
import { TaskLists } from "./tasks/TaskLists";

export { shouldClearTaskAlert, taskVisibleInTab } from "./tasks/task-model";

type IcloudStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  calendars: string[];
  reminders: string[];
  authBackoffUntil?: string;
};

type TaskAudioStatus = {
  exists: boolean;
};

const ALERT_AUDIO_PATH = "/api/tasks/audio";
// Fallbacks only. The live values come from config.tasks.alertAudio
// (alertWindowMs / repeatMs) via the shared client config — they were declared
// in the schema and documented in SPEC but nothing read them until now.
const ALERT_AUDIO_WINDOW_MS = 5000;
const ALERT_AUDIO_REPEAT_MS = 5 * 60 * 1000;

function alertAudioTimingFromConfig(config: unknown) {
  const root = config as { tasks?: { alertAudio?: { alertWindowMs?: unknown; repeatMs?: unknown } } } | null;
  const audio = root?.tasks?.alertAudio;
  if (!audio) {
    return null;
  }

  const windowMs = audio.alertWindowMs;
  const repeatMs = audio.repeatMs;

  return {
    windowMs:
      typeof windowMs === "number" && Number.isFinite(windowMs) && windowMs > 0
        ? windowMs
        : ALERT_AUDIO_WINDOW_MS,
    repeatMs:
      typeof repeatMs === "number" && Number.isFinite(repeatMs) && repeatMs > 0
        ? repeatMs
        : ALERT_AUDIO_REPEAT_MS,
  };
}

const inputClassName =
  "min-h-11 w-full border border-neutral-700 bg-neutral-950/70 px-3 py-2 font-mono text-sm font-black uppercase text-neutral-100 outline-none focus:border-cyan-300";

const repeatOptions: Array<{ label: string; value: TaskRepeatDraftKind }> = [
  { label: "Hourly", value: "hourly" },
  { label: "Morning/night", value: "morning-night" },
  { label: "N days after completion", value: "days" },
  { label: "After another reminder", value: "after" },
];

const FOLLOW_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

const IMPORT_TEMPLATE = [
  "# start,end,name,repeat",
  "2026-05-01 09:00,2026-05-01 09:30,Feed starter,days:1",
  "21:00,,Medication reminder,morning/night",
].join("\n");

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function CurrentTaskBar({ task }: { task: Task | null }) {
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

function TaskSourceIcon({ task }: { task: Task }) {
  if (task.source === "icloud-calendar") {
    return <CalendarDays className="h-4 w-4 text-cyan-200" aria-label="iCloud calendar" />;
  }
  if (task.source === "icloud-reminders") {
    return <ListTodo className="h-4 w-4 text-cyan-200" aria-label="iCloud reminder" />;
  }
  return null;
}

function TaskCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={classNames("cyber-checkbox-row border p-3 text-left", checked && "cyber-checkbox-row-active")}
      onClick={() => onChange(!checked)}
    >
      <span className={classNames("cyber-checkbox", checked && "cyber-checkbox-checked")} aria-hidden="true">
        {checked ? <Check className="h-5 w-5" strokeWidth={3} /> : null}
      </span>
      <span className="theme-display-label zone-title-bar">{label}</span>
    </button>
  );
}

function TaskEditor({
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

function ReadOnlyTaskPanel({
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

function ImportModal({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ParseTaskCsvResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<IcloudStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadIcloudStatus = useCallback(async () => {
    try {
      const payload = await jsonFetch<IcloudStatus>("/api/tasks/icloud-status", { cache: "no-store" });
      setStatus(payload);
      setStatusError(null);
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : "Failed to read iCloud status");
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadIcloudStatus();
  }, [loadIcloudStatus, open]);

  if (!open) {
    return null;
  }

  const parsePreview = () => {
    const result = parseTaskCsv(csv, new Date());
    setPreview(result);
    setMessage(`${result.tasks.length} valid row${result.tasks.length === 1 ? "" : "s"}`);
  };

  const confirmImport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = await jsonFetch<{ created: Task[]; errors: ParseTaskCsvResult["errors"] }>("/api/tasks/bulk", {
        method: "POST",
        body: JSON.stringify({ csv, referenceDate: new Date().toISOString() }),
      });
      setPreview({ tasks: payload.created, errors: payload.errors });
      setMessage(`Imported ${payload.created.length} reminder${payload.created.length === 1 ? "" : "s"}`);
      if (!payload.errors.length) {
        setCsv("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const payload = await jsonFetch<{ status?: IcloudStatus; result?: { added: number; updated: number; removed: number } }>(
        "/api/tasks/sync-icloud",
        { method: "POST", body: "{}" },
      );
      if (payload.status) {
        setStatus(payload.status);
      } else {
        await loadIcloudStatus();
      }
      if (payload.result) {
        setMessage(
          `iCloud sync: ${payload.result.added} added, ${payload.result.updated} updated, ${payload.result.removed} removed`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "iCloud sync failed");
      await loadIcloudStatus();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="tasks-modal grid max-h-[92vh] w-full max-w-3xl gap-4 overflow-auto border border-neutral-700 bg-neutral-950 p-4 text-neutral-100">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black uppercase">Import reminders</h2>
            <p className="font-mono text-xs font-black uppercase text-neutral-500">start,end,name,repeat</p>
          </div>
          <button
            className="inline-flex h-11 w-11 items-center justify-center border border-neutral-700"
            type="button"
            onClick={onClose}
            aria-label="Close import"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <section className="grid gap-3 border border-neutral-700 bg-neutral-950/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase text-cyan-100">iCloud</h3>
              <p className="font-mono text-xs font-black uppercase text-neutral-500">
                {status?.enabled ? "Calendar and reminders mirror" : "Local-only mode"}
              </p>
            </div>
            <button
              className="inline-flex min-h-10 items-center gap-2 border border-cyan-300/60 px-3 py-2 text-xs font-black"
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing || !status?.enabled}
            >
              <RefreshCw className={classNames("h-4 w-4", syncing && "animate-spin")} />
              Sync now
            </button>
          </div>
          {statusError ? <p className="text-sm font-black uppercase text-red-400">{statusError}</p> : null}
          {status ? (
            <div className="grid gap-1 font-mono text-xs font-black uppercase text-neutral-400">
              <span>Last sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "Never"}</span>
              <span>Calendars: {status.calendars.length ? status.calendars.join(", ") : "None"}</span>
              <span>Reminder lists: {status.reminders.length ? status.reminders.join(", ") : "None"}</span>
              {status.lastError ? <span className="text-red-400">Error: {status.lastError}</span> : null}
            </div>
          ) : null}
        </section>

        <section className="grid gap-2 border border-neutral-700 bg-neutral-950/70 p-3">
          <h3 className="text-sm font-black uppercase text-cyan-100">Template</h3>
          <pre className="select-text whitespace-pre-wrap font-mono text-xs font-black uppercase text-neutral-300">
            {IMPORT_TEMPLATE}
          </pre>
        </section>

        <textarea
          className="min-h-48 w-full resize-y border border-neutral-700 bg-neutral-950/70 p-3 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={IMPORT_TEMPLATE}
          spellCheck={false}
        />

        <div className="flex flex-wrap justify-between gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-4 py-2 text-sm font-black"
            type="button"
            onClick={parsePreview}
          >
            <ClipboardList className="h-4 w-4" />
            Parse
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100"
            type="button"
            onClick={() => void confirmImport()}
            disabled={busy || !preview?.tasks.length}
          >
            <Upload className="h-4 w-4" />
            {busy ? "Importing" : "Confirm import"}
          </button>
        </div>

        {message ? <p className="font-mono text-sm font-black uppercase text-cyan-100">{message}</p> : null}

        {preview ? (
          <div className="grid gap-2">
            {preview.errors.map((error) => (
              <div
                key={`${error.line}-${error.message}`}
                className="border border-red-400/60 bg-red-500/10 p-2 font-mono text-sm font-black uppercase text-red-100"
              >
                Line {error.line}: {error.message}
              </div>
            ))}
            {preview.tasks.map((task) => (
              <div
                key={task.id}
                className="grid gap-1 border border-neutral-700 bg-neutral-950/70 p-2 font-mono text-sm font-black uppercase"
              >
                <span className="text-neutral-100">{task.name}</span>
                <span className="text-neutral-500">{timeRange(task)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ExportModal({
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

export function TasksPanel({ showPanel = true }: { showPanel?: boolean }) {
  const runModuleIntercepts = useModuleIntercepts();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<TaskDraft>(() => defaultDraft());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [rosterGlyphs, setRosterGlyphs] = useState<RosterGlyphs>(() => new Map());
  const [editMode, setEditMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Per-device: does this screen show the reminder banners at all? Repeat
  // behaviour is no longer tied to this -- that is per-reminder (`annoy`).
  const [bannersEnabled] = useReminderBannerSetting();
  const [audioTiming, setAudioTiming] = useState({
    windowMs: ALERT_AUDIO_WINDOW_MS,
    repeatMs: ALERT_AUDIO_REPEAT_MS,
  });
  const audioWindowMs = audioTiming.windowMs;
  const audioRepeatMs = audioTiming.repeatMs;
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [taskAudioExists, setTaskAudioExists] = useState(false);
  const alertRef = useRef<AlertState | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Which clip the reminder alert plays, per the theme's assignment. Recomputed
  // when the assignments or the theme's own control sound change; null means
  // the action is set to None (specs/ux-sounds.md).
  const { theme: soundTheme } = useDeviceTheme();
  const reminderAlertUrl = useMemo(
    () => resolveUxSoundUrl("reminderAlert"),
    [soundTheme.uxSounds],
  );
  const audioStopTimer = useRef<number | null>(null);
  const audioRepeatTimer = useRef<number | null>(null);
  const taskPushRevision = useRef(0);
  const dismissingTaskIds = useRef<Set<string>>(new Set());
  // Occurrences this screen has already chimed for, keyed `taskId:sessionKey`.
  // Purely a local fast path in front of the shared `alertChimedFor`.
  const { hasWashing } = useOrbSettings();
  const chimedOccurrences = useRef<Set<string>>(new Set());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    alertRef.current = alert;
  }, [alert]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    let loading = false;

    const loadTasks = async () => {
      if (loading) {
        return;
      }

      loading = true;
      const revision = taskPushRevision.current;
      try {
        const payload = await jsonFetch<{ tasks: Task[] }>("/api/tasks?command=list", { cache: "no-store" });
        // A push (tasks list or a dismissal) that landed while this fetch was in
        // flight is newer; a stale list would re-raise a dismissed alert and
        // restart its sound on this screen only.
        if (alive && revision === taskPushRevision.current) {
          setTasks(payload.tasks);
          setTasksLoaded(true);
        }
      } catch (error) {
        if (alive) {
          setMessage(error instanceof Error ? error.message : "Failed to load reminders");
        }
      } finally {
        loading = false;
      }
    };

    const refreshWhenVisible = () => {
      if (!document.hidden) {
        void loadTasks();
      }
    };

    void loadTasks();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      alive = false;
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    void jsonFetch<TaskAudioStatus>("/api/tasks/audio?status=1", { cache: "no-store" })
      .then((payload) => {
        if (alive) {
          setTaskAudioExists(payload.exists);
        }
      })
      .catch(() => {
        if (alive) {
          setTaskAudioExists(false);
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const stopAudio = useCallback(() => {
    if (audioStopTimer.current !== null) {
      window.clearTimeout(audioStopTimer.current);
      audioStopTimer.current = null;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const clearAudioCadence = useCallback(() => {
    if (audioRepeatTimer.current !== null) {
      window.clearInterval(audioRepeatTimer.current);
      audioRepeatTimer.current = null;
    }
    stopAudio();
  }, [stopAudio]);

  const playAudioWindow = useCallback(() => {
    if (!taskAudioExists || !reminderAlertUrl) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAudio();
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.info("[nova-dashboard] task alert audio blocked or unavailable", error);
    });
    audioStopTimer.current = window.setTimeout(stopAudio, audioWindowMs);
  }, [audioWindowMs, reminderAlertUrl, stopAudio, taskAudioExists]);

  const startAudioCadence = useCallback(
    (annoy: boolean) => {
      if (!taskAudioExists) {
        clearAudioCadence();
        return;
      }

      clearAudioCadence();
      playAudioWindow();

      // Only a reminder explicitly marked as an annoyer nags. Everything else
      // gets exactly one chime per occurrence, household-wide -- see
      // `hasTaskAlertChimed`. The banner (where enabled) still waits to be
      // tapped; it just does so quietly.
      if (annoy) {
        audioRepeatTimer.current = window.setInterval(playAudioWindow, audioRepeatMs);
      }
    },
    [audioRepeatMs, clearAudioCadence, playAudioWindow, taskAudioExists],
  );

  const clearAlert = useCallback(
    (taskId?: string) => {
      const active = alertRef.current;
      if (taskId && active?.taskId !== taskId) {
        return;
      }

      setAlert(null);
      document.body.classList.remove("task-alerting");
      clearAudioCadence();
    },
    [clearAudioCadence],
  );

  const triggerAlert = useCallback((nextAlert: AlertState) => {
    const dismissed = tasksRef.current.some((task) => task.id === nextAlert.taskId && (isTaskComplete(task) || isTaskAlertSilenced(task)));
    if (dismissed) {
      return;
    }

    setAlert((current) => (current?.taskId === nextAlert.taskId ? current : nextAlert));
  }, []);

  const dismissAlert = useCallback(
    async ({ post = true, taskId, updateTask = true }: { post?: boolean; taskId?: string; updateTask?: boolean } = {}) => {
      const active = alertRef.current;
      const targetTaskId = taskId ?? active?.taskId;
      if (!targetTaskId) {
        return;
      }
      if (dismissingTaskIds.current.has(targetTaskId)) {
        return;
      }

      dismissingTaskIds.current.add(targetTaskId);
      const alertDismissedAt = new Date().toISOString();
      if (updateTask) {
        setTasks((current) =>
          current.map((task) =>
            task.id === targetTaskId
              ? {
                  ...task,
                  alertDismissedAt,
                  alertDismissedFor: taskAlertSessionKey(task),
                  alertChimedFor: taskAlertSessionKey(task),
                }
              : task,
          ),
        );
      }
      if (active?.taskId === targetTaskId) {
        clearAlert(targetTaskId);
      }

      try {
        if (post) {
          const task = await jsonFetch<Task>(`/api/tasks/${encodeURIComponent(targetTaskId)}/dismiss`, {
            method: "POST",
            body: "{}",
          });
          setTasks((current) => current.map((candidate) => (candidate.id === targetTaskId ? task : candidate)));
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to dismiss reminder");
      } finally {
        dismissingTaskIds.current.delete(targetTaskId);
      }
    },
    [clearAlert],
  );

  useEffect(() => {
    const apply = (config: unknown) => {
      const timing = alertAudioTimingFromConfig(config);
      if (timing) {
        setAudioTiming(timing);
      }
    };

    apply(readCachedClientConfig());
    void loadSharedClientConfig().then(apply).catch(() => {
      // Falling back to the compiled-in cadence is fine; this is a sound.
    });
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const unsubscribe = subscribeToDashboardEvents({
      tasks: (event) => {
        try {
          taskPushRevision.current += 1;
          const payload = JSON.parse(event.data) as { tasks?: Task[] } | Task[];
          setTasks(Array.isArray(payload) ? payload : (payload.tasks ?? []));
          setTasksLoaded(true);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to read reminder event");
        }
      },
      "task-alert": (event) => {
        try {
          const payload = JSON.parse(event.data) as AlertState;
          if (payload.taskId && payload.name) {
            triggerAlert(payload);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to read reminder alert");
        }
      },
      "task-dismiss": (event) => {
        try {
          const payload = JSON.parse(event.data) as { taskId?: string };
          if (payload.taskId) {
            taskPushRevision.current += 1;
            // updateTask: the local list must carry the acknowledgement too, or
            // the orb, the chime and the alert effect re-raise it from stale data.
            void dismissAlert({ post: false, taskId: payload.taskId, updateTask: true });
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Failed to read reminder dismissal");
        }
      },
      "dashboard-error": (event) => {
        try {
          const payload = JSON.parse(event.data) as { message?: string };
          if (payload.message) {
            setMessage(payload.message);
          }
        } catch {
          setMessage("Dashboard event error");
        }
      },
      "task-audio": (event) => {
        try {
          const payload = JSON.parse(event.data) as TaskAudioStatus;
          setTaskAudioExists(Boolean(payload.exists));
        } catch {
          setTaskAudioExists(false);
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [dismissAlert, triggerAlert]);

  useEffect(() => {
    if (tasksLoaded && alert && shouldClearTaskAlert(tasks, alert, nowMs)) {
      clearAlert(alert.taskId);
    }
  }, [alert, clearAlert, nowMs, tasks, tasksLoaded]);

  useEffect(() => {
    if (alert) {
      return;
    }

    const nextAlertTask = tasks
      .filter((task) => isTaskAlerting(task, nowMs))
      .sort((left, right) => taskStartMs(left) - taskStartMs(right))[0];
    if (nextAlertTask) {
      triggerAlert({ taskId: nextAlertTask.id, name: nextAlertTask.name, end: nextAlertTask.end });
    }
  }, [alert, nowMs, tasks, triggerAlert]);

  useEffect(() => {
    if (!alert || !bannersEnabled) {
      return;
    }

    document.body.classList.add("task-alerting");
    return () => {
      document.body.classList.remove("task-alerting");
    };
  }, [alert, bannersEnabled]);

  // The chime is a property of the occurrence, not of the alert being on
  // screen. Resolving the alerting task lets us ask two questions the alert
  // itself cannot answer: has this occurrence already been chimed (by this
  // screen before a reload, or by another screen entirely), and did the user
  // ask for an annoyer?
  //
  // These are flattened to primitives on purpose. Depending on the task object
  // would restart the audio on every SSE task push, cutting the sound off
  // mid-window; `alertChimedFor` in particular changes the moment we claim the
  // chime, which would otherwise tear down the very window it just opened.
  const alertTask = useMemo(
    () => (alert ? (tasks.find((task) => task.id === alert.taskId) ?? null) : null),
    [alert, tasks],
  );
  const alertTaskId = alertTask?.id ?? null;
  const alertOccurrence = alertTask ? `${alertTask.id}:${taskAlertSessionKey(alertTask)}` : null;
  const alertAnnoy = alertTask ? isTaskAnnoyer(alertTask) : false;
  const alertChimed = alertTask ? hasTaskAlertChimed(alertTask) : false;
  const alertChimedRef = useRef(false);
  const washAlertId = alertTask && washReminder(alertTask)?.phase === "active" ? alertTask.id : null;



  useEffect(() => {
    alertChimedRef.current = alertChimed;
  }, [alertChimed]);

  useEffect(() => {
    if (washAlertId || !alertOccurrence || !alertTaskId || !taskAudioExists) {
      return;
    }

    // Locally claimed occurrences cover the gap before the server round trip
    // lands and the task broadcast comes back.
    const claimedLocally = chimedOccurrences.current.has(alertOccurrence);
    if (!alertAnnoy && (alertChimedRef.current || claimedLocally)) {
      return;
    }

    chimedOccurrences.current.add(alertOccurrence);
    startAudioCadence(alertAnnoy);
    if (!claimedLocally) {
      void jsonFetch<Task>(`/api/tasks/${encodeURIComponent(alertTaskId)}/chimed`, { method: "POST" }).catch(() => {
        // A failed claim only costs a repeat chime on the next reload; it must
        // never surface as an error toast over the reminder banner.
      });
    }

    return () => {
      clearAudioCadence();
    };
  }, [alertAnnoy, alertOccurrence, alertTaskId, clearAudioCadence, startAudioCadence, taskAudioExists, washAlertId]);

  // Capture-phase swallow so the tap that silences the alarm cannot also hit a
  // light button underneath. With banners disabled there IS no overlay to tap,
  // and installing this anyway would eat taps meant for the reminder icon bar.
  useEffect(() => {
    if (!alert || !bannersEnabled) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".task-alert-banner")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void dismissAlert({ post: true });
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [alert, bannersEnabled, dismissAlert]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("task-alerting");
      clearAudioCadence();
    };
  }, [clearAudioCadence]);

  const activeTask = useMemo(
    () => tasks.filter((task) => isTaskCurrent(task, nowMs)).sort((left, right) => taskStartMs(left) - taskStartMs(right))[0] ?? null,
    [nowMs, tasks],
  );

  // Only local reminders can anchor a follow-on: an iCloud mirror is completed
  // upstream, so nothing here would ever see the completion that moves it.
  const anchorOptions = useMemo(
    () =>
      tasks
        .filter((task) => task.source === "local" && !task.readOnly && !task.follows)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [tasks],
  );

  const selectedCount = selectedTaskIds.size;

  const editorOpen = createOpen || expandedTaskId !== null;
  useEffect(() => {
    if (!editorOpen) return;
    let alive = true;
    loadRosterGlyphs()
      .then((glyphs) => {
        if (alive) setRosterGlyphs(glyphs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [editorOpen]);

  const writeGlyph = async (write: ReturnType<typeof glyphWriteForSave>) => {
    if (!write) return;
    try {
      await writeReminderGlyph(write);
      setRosterGlyphs((current) => new Map(current).set(write.key, write.glyph));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save reminder icon");
    }
  };

  const saveNewTask = async (draft: TaskEditorSaveDraft, glyph: ReminderGlyph | null) => {
    setBusyId("create");
    try {
      const created = await jsonFetch<Task>("/api/tasks?command=add", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      // Written after the create, keyed by the name the reminder was saved under.
      await writeGlyph(glyphWriteForSave({ chosen: glyph, glyphs: rosterGlyphs, name: created?.name ?? draft.name }));
      setCreateOpen(false);
      setCreateDraft(defaultDraft());
      setMessage("Reminder added");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add reminder");
    } finally {
      setBusyId(null);
    }
  };

  const saveTask = async (task: Task, draft: TaskEditorSaveDraft, glyph: ReminderGlyph | null) => {
    setBusyId(task.id);
    try {
      await jsonFetch<Task>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      // A rename carries the glyph to the new key.
      await writeGlyph(glyphWriteForSave({ chosen: glyph, glyphs: rosterGlyphs, name: draft.name, previousName: task.name }));
      setExpandedTaskId(null);
      setMessage("Reminder saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save reminder");
    } finally {
      setBusyId(null);
    }
  };

  const convertTaskToLocal = async (task: Task) => {
    setBusyId(task.id);
    try {
      await jsonFetch<Task>("/api/tasks?command=add", {
        method: "POST",
        body: JSON.stringify({ name: task.name, start: task.start, end: task.end ?? null }),
      });
      await jsonFetch<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
      });
      setExpandedTaskId(null);
      setMessage("Converted to local");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to convert reminder");
    } finally {
      setBusyId(null);
    }
  };

  const deleteSelected = async () => {
    if (!selectedCount) {
      return;
    }
    if (!window.confirm(`Delete ${selectedCount} selected reminder${selectedCount === 1 ? "" : "s"}?`)) {
      return;
    }

    const ids = Array.from(selectedTaskIds);
    setBusyId("delete");
    try {
      await Promise.all(
        ids.map((id) =>
          jsonFetch<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(id)}`, {
            method: "DELETE",
          }),
        ),
      );
      setSelectedTaskIds(new Set());
      setEditMode(false);
      setMessage("Selected reminders deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete selected reminders");
    } finally {
      setBusyId(null);
    }
  };

  const completeTask = async (task: Task) => {
    if (dismissingTaskIds.current.has(task.id)) {
      return;
    }

    // Before the optimistic dismissal, so a cancelled completion leaves the
    // reminder exactly where it was.
    const proceed = await runModuleIntercepts({
      id: "reminder.complete",
      source: "client",
      task: { id: task.id, name: task.name, moduleData: task.moduleData },
    });
    if (!proceed) {
      return;
    }

    dismissingTaskIds.current.add(task.id);
    setBusyId(task.id);
    const dismissedAt = new Date().toISOString();
    setTasks((current) =>
      current.map((candidate) => (candidate.id === task.id ? { ...candidate, dismissedAt: candidate.dismissedAt ?? dismissedAt } : candidate)),
    );
    if (alertRef.current?.taskId === task.id) {
      clearAlert(task.id);
    }

    try {
      const updated = await jsonFetch<Task>(`/api/tasks/${encodeURIComponent(task.id)}/complete`, {
        method: "POST",
        body: "{}",
      });
      setTasks((current) => current.map((candidate) => (candidate.id === task.id ? updated : candidate)));
      setExpandedTaskId(null);
      setMessage("Reminder done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to mark reminder done");
    } finally {
      dismissingTaskIds.current.delete(task.id);
      setBusyId(null);
    }
  };

  const toggleEditMode = () => {
    setEditMode((current) => {
      const next = !current;
      if (next) {
        setExpandedTaskId(null);
        setCreateOpen(false);
      } else {
        setSelectedTaskIds(new Set());
      }
      return next;
    });
  };

  const toggleSelectedTask = (taskId: string) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const rowClick = (task: Task) => {
    if (editMode) {
      toggleSelectedTask(task.id);
      return;
    }

    setCreateOpen(false);
    setExpandedTaskId((current) => (current === task.id ? null : task.id));
  };

  const renderTaskRow = (task: Task) => {
    const status = statusForTask(task, nowMs);
    const repeat =
      repeatLabel(task.repeat) ??
      followsLabel(task.follows, tasks.find((candidate) => candidate.id === task.follows?.taskId)?.name);
    const selected = selectedTaskIds.has(task.id);
    const canComplete = status !== "Done";

    return (
      <div key={task.id} className="task-card">
        <div
          className={classNames(
            "task-row grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-neutral-700 bg-neutral-950/70 p-3 text-left",
            selected && "border-cyan-300/60 bg-cyan-300/10",
          )}
        >
          <button className="task-row-main min-w-0 w-full text-left" type="button" onClick={() => rowClick(task)}>
            <div className="flex min-w-0 items-center gap-3">
              {editMode ? (
                <span
                  className={classNames(
                    "inline-flex h-7 w-7 flex-none items-center justify-center border border-neutral-600",
                    selected && "border-cyan-300 bg-cyan-300 text-neutral-950",
                  )}
                >
                  {selected ? <CircleCheck className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                </span>
              ) : null}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <TaskSourceIcon task={task} />
                  <p className="truncate text-lg font-black uppercase text-neutral-100">{task.name}</p>
                </div>
                <p className="mt-1 font-mono text-sm font-black uppercase text-neutral-500">{timeRange(task)}</p>
                {repeat ? (
                  <p className="mt-1 flex items-center gap-1 font-mono text-xs font-black uppercase text-cyan-200/80">
                    <RefreshCw className="h-3.5 w-3.5" />
                    {repeat}
                  </p>
                ) : null}
                {task.sourceCalendar ? (
                  <p className="mt-1 truncate font-mono text-xs font-black uppercase text-neutral-500">
                    {sourceLabel(task.source)} / {task.sourceCalendar}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
          <div className="grid justify-items-end gap-2">
            <span
              className={classNames(
                "whitespace-nowrap border px-2 py-1 font-mono text-xs font-black uppercase",
                statusClassName(status),
              )}
            >
              {status}
            </span>
            {canComplete && !editMode ? (
              <button
                className="inline-flex min-h-9 items-center gap-2 border border-cyan-300/60 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100"
                type="button"
                onClick={() => void completeTask(task)}
                disabled={busyId === task.id}
              >
                <Check className="h-4 w-4" />
                Done
              </button>
            ) : null}
          </div>
        </div>

      </div>
    );
  };

  const closeEditor = () => {
    setCreateOpen(false);
    setExpandedTaskId(null);
  };

  const expandedTask = editMode || createOpen ? null : (tasks.find((task) => task.id === expandedTaskId) ?? null);
  // One editor at a time, shown in place of the lists.
  const editorView = createOpen && !editMode ? (
    <TaskEditor
      anchorOptions={anchorOptions}
      busy={busyId === "create"}
      initial={createDraft}
      onCancel={closeEditor}
      onSave={saveNewTask}
      rosterGlyphs={rosterGlyphs}
      submitLabel="Create"
    />
  ) : expandedTask ? (
    expandedTask.readOnly || expandedTask.source !== "local" ? (
      <ReadOnlyTaskPanel busy={busyId === expandedTask.id} onConvert={convertTaskToLocal} task={expandedTask} />
    ) : (
      <TaskEditor
        key={expandedTask.id}
        anchorOptions={anchorOptions.filter((candidate) => candidate.id !== expandedTask.id)}
        busy={busyId === expandedTask.id}
        initial={taskDraft(expandedTask)}
        onCancel={closeEditor}
        onSave={(draft, glyph) => saveTask(expandedTask, draft, glyph)}
        rosterGlyphs={rosterGlyphs}
        submitLabel="Save"
      />
    )
  ) : null;

  return (
    <>
      <OrbCompletionAudio tasks={tasks} />
      {bannersEnabled ? <CurrentTaskBar task={hasWashing && activeTask && washReminder(activeTask) ? null : activeTask} /> : null}

      {bannersEnabled && alert && !(hasWashing && washAlertId) ? (
        <button
          className="task-alert-overlay"
          type="button"
          data-ux-sound="reminderConfirm"
          aria-label={`Dismiss ${alert.name} notification`}
          onClick={() => void dismissAlert({ post: true })}
        >
          <span className="task-alert-banner" role="alert">
            <span className="task-alert-title">{alert.name}</span>
          </span>
        </button>
      ) : null}

      {/* Source comes from the theme's `reminderAlert` assignment, which
          defaults to the uploaded reminder MP3 (specs/ux-sounds.md). */}
      {taskAudioExists && reminderAlertUrl ? <audio ref={audioRef} src={reminderAlertUrl} preload="auto" /> : null}

      {showPanel ? (
        <>
          <section className="tasks-panel border border-neutral-700 bg-neutral-950/70 p-4">
            {/* No heading: the highlighted menu item already names the panel
                (Adeline, 2026-09-16, specs/tasks-panel.md). */}
            <div className="grid gap-3">
              {/* Only the timer above the line; everything else past it (specs/tasks-panel.md). */}
              <AdvancedFold
                advanced={
                  <TasksAdvanced
                    editor={editorView}
                    onBack={closeEditor}
                    lists={
                      <>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-3 py-2 text-sm font-black"
                            type="button"
                            onClick={() => {
                              setCreateOpen((current) => {
                                const next = !current;
                                if (next) {
                                  setCreateDraft(defaultDraft());
                                }
                                return next;
                              });
                              setExpandedTaskId(null);
                              setEditMode(false);
                            }}
                          >
                            <Plus className="h-4 w-4" />
                            Add
                          </button>
                          <button
                            className={classNames(
                              "inline-flex min-h-11 items-center gap-2 border px-3 py-2 text-sm font-black",
                              editMode ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100" : "border-neutral-700",
                            )}
                            type="button"
                            onClick={toggleEditMode}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-3 py-2 text-sm font-black"
                            type="button"
                            onClick={() => setImportOpen(true)}
                          >
                            <Upload className="h-4 w-4" />
                            Import
                          </button>
                          <button
                            className="inline-flex min-h-11 items-center gap-2 border border-neutral-700 px-3 py-2 text-sm font-black"
                            type="button"
                            onClick={() => setExportOpen(true)}
                          >
                            <Download className="h-4 w-4" />
                            Export
                          </button>
                        </div>

                        {editMode ? (
                          <div className="flex flex-wrap items-center justify-end gap-3">
                            <button
                              className="inline-flex min-h-10 items-center gap-2 border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm font-black text-red-100"
                              type="button"
                              onClick={() => void deleteSelected()}
                              disabled={!selectedCount || busyId === "delete"}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete ({selectedCount})
                            </button>
                          </div>
                        ) : null}

                        {message ? (
                          <div className="border border-cyan-300/40 bg-cyan-300/10 p-2 font-mono text-sm font-black uppercase text-cyan-100">
                            {message}
                          </div>
                        ) : null}

                        <TaskLists nowMs={nowMs} renderRow={renderTaskRow} tasks={tasks} />
                      </>
                    }
                  />
                }
              >
                <TimerEncoder />
              </AdvancedFold>
            </div>
          </section>

          <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
          <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} tasks={tasks} />
        </>
      ) : null}
    </>
  );
}
