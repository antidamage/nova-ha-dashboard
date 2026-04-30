"use client";

import {
  Bell,
  BellOff,
  CalendarDays,
  Check,
  Circle,
  CircleCheck,
  ClipboardList,
  Clock3,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { parseTaskCsv, type ParseTaskCsvResult } from "../../lib/parse-task-csv";
import type { Task, TaskSource } from "../../lib/types";

type TaskTab = "today" | "upcoming";

type TaskDraft = {
  name: string;
  start: string;
  end: string;
};

type AlertState = {
  taskId: string;
  name: string;
  end: string;
};

type IcloudStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  calendars: string[];
  reminders: string[];
  authBackoffUntil?: string;
};

const ALERT_AUDIO_PATH = "/sounds/task-alert.mp3";
const ALERT_AUDIO_WINDOW_MS = 5000;
const ALERT_AUDIO_REPEAT_MS = 5 * 60 * 1000;
const TASK_TIME_FORMATTER = new Intl.DateTimeFormat("en-NZ", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const inputClassName =
  "min-h-11 w-full border border-neutral-700 bg-neutral-950/70 px-3 py-2 font-mono text-sm font-black uppercase text-neutral-100 outline-none focus:border-cyan-300";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function localInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoToLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return localInputValue(date);
}

function localInputToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function defaultDraft(): TaskDraft {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 5);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    name: "",
    start: localInputValue(start),
    end: localInputValue(end),
  };
}

function taskDraft(task: Task): TaskDraft {
  return {
    name: task.name,
    start: isoToLocalInput(task.start),
    end: isoToLocalInput(task.end),
  };
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function taskStartMs(task: Task) {
  return new Date(task.start).getTime();
}

function taskEndMs(task: Task) {
  return new Date(task.end).getTime();
}

function isTaskActive(task: Task, nowMs: number) {
  const start = taskStartMs(task);
  const end = taskEndMs(task);
  return Number.isFinite(start) && Number.isFinite(end) && start <= nowMs && nowMs < end;
}

function isTaskAlerting(task: Task, nowMs: number) {
  return isTaskActive(task, nowMs) && !task.dismissedAt;
}

function timeRange(task: Task) {
  return `${TASK_TIME_FORMATTER.format(new Date(task.start))} - ${TASK_TIME_FORMATTER.format(new Date(task.end))}`;
}

function sourceLabel(source: TaskSource) {
  if (source === "icloud-calendar") {
    return "Calendar";
  }
  if (source === "icloud-reminders") {
    return "Reminder";
  }
  return "Local";
}

function statusForTask(task: Task, nowMs: number) {
  if (taskEndMs(task) <= nowMs) {
    return "Done";
  }
  if (isTaskActive(task, nowMs)) {
    return task.dismissedAt ? "Dismissed" : "Active";
  }
  return "Upcoming";
}

function statusClassName(status: string) {
  if (status === "Active") {
    return "border-cyan-300/50 bg-cyan-300/10 text-cyan-100";
  }
  if (status === "Dismissed") {
    return "border-yellow-300/50 bg-yellow-300/10 text-yellow-100";
  }
  if (status === "Done") {
    return "border-neutral-600 bg-neutral-900/70 text-neutral-400";
  }
  return "border-emerald-300/50 bg-emerald-300/10 text-emerald-100";
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Request failed");
  }

  return payload as T;
}

function CurrentTaskChip({ task }: { task: Task | null }) {
  if (!task) {
    return null;
  }

  return (
    <div className="current-task-chip" aria-live="polite">
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

function TaskEditor({
  busy,
  initial,
  onCancel,
  onSave,
  submitLabel,
}: {
  busy: boolean;
  initial: TaskDraft;
  onCancel: () => void;
  onSave: (draft: { name: string; start: string; end: string }) => Promise<void>;
  submitLabel: string;
}) {
  const [draft, setDraft] = useState<TaskDraft>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initial);
    setError(null);
  }, [initial.end, initial.name, initial.start]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = localInputToIso(draft.start);
    const end = localInputToIso(draft.end);

    if (!draft.name.trim()) {
      setError("Task name is required");
      return;
    }
    if (!start || !end) {
      setError("Start and end are required");
      return;
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      setError("End must be after start");
      return;
    }

    setError(null);
    await onSave({ name: draft.name.trim(), start, end });
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
          Start
          <input
            className={inputClassName}
            type="datetime-local"
            value={draft.start}
            onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))}
          />
        </label>
        <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
          End
          <input
            className={inputClassName}
            type="datetime-local"
            value={draft.end}
            onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))}
          />
        </label>
      </div>
      {error ? <p className="text-sm font-black uppercase text-red-400">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
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
      setMessage(`Imported ${payload.created.length} task${payload.created.length === 1 ? "" : "s"}`);
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
            <h2 className="text-xl font-black uppercase">Import tasks</h2>
            <p className="font-mono text-xs font-black uppercase text-neutral-500">start,end,name</p>
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

        <textarea
          className="min-h-48 w-full resize-y border border-neutral-700 bg-neutral-950/70 p-3 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
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

export function TasksPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [tab, setTab] = useState<TaskTab>("today");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<TaskDraft>(() => defaultDraft());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const alertRef = useRef<AlertState | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioStopTimer = useRef<number | null>(null);
  const audioRepeatTimer = useRef<number | null>(null);
  const dismissingTaskIds = useRef<Set<string>>(new Set());

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

    void jsonFetch<{ tasks: Task[] }>("/api/tasks", { cache: "no-store" })
      .then((payload) => {
        if (alive) {
          setTasks(payload.tasks);
        }
      })
      .catch((error) => {
        if (alive) {
          setMessage(error instanceof Error ? error.message : "Failed to load tasks");
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
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    stopAudio();
    audio.currentTime = 0;
    // TODO: Add public/sounds/task-alert.mp3. The user can replace it with the final alert tone.
    audio.play().catch((error) => {
      console.info("[nova-dashboard] task alert audio blocked or unavailable", error);
    });
    audioStopTimer.current = window.setTimeout(stopAudio, ALERT_AUDIO_WINDOW_MS);
  }, [stopAudio]);

  const startAudioCadence = useCallback(() => {
    clearAudioCadence();
    playAudioWindow();
    audioRepeatTimer.current = window.setInterval(playAudioWindow, ALERT_AUDIO_REPEAT_MS);
  }, [clearAudioCadence, playAudioWindow]);

  const triggerAlert = useCallback((nextAlert: AlertState) => {
    const dismissed = tasksRef.current.some((task) => task.id === nextAlert.taskId && task.dismissedAt);
    if (dismissed) {
      return;
    }

    setAlert((current) => (current?.taskId === nextAlert.taskId ? current : nextAlert));
  }, []);

  const dismissAlert = useCallback(
    async ({ post = true, taskId }: { post?: boolean; taskId?: string } = {}) => {
      const active = alertRef.current;
      const targetTaskId = taskId ?? active?.taskId;
      if (!targetTaskId) {
        return;
      }
      if (dismissingTaskIds.current.has(targetTaskId)) {
        return;
      }

      dismissingTaskIds.current.add(targetTaskId);
      const dismissedAt = new Date().toISOString();
      setTasks((current) =>
        current.map((task) => (task.id === targetTaskId ? { ...task, dismissedAt: task.dismissedAt ?? dismissedAt } : task)),
      );
      if (active?.taskId === targetTaskId) {
        setAlert(null);
        document.body.classList.remove("task-alerting");
        clearAudioCadence();
      }

      try {
        if (post) {
          await jsonFetch<Task>(`/api/tasks/${encodeURIComponent(targetTaskId)}/dismiss`, {
            method: "POST",
            body: "{}",
          });
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to dismiss task");
      } finally {
        dismissingTaskIds.current.delete(targetTaskId);
      }
    },
    [clearAudioCadence],
  );

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const events = new EventSource("/api/events");
    const handleTasks = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { tasks?: Task[] } | Task[];
        setTasks(Array.isArray(payload) ? payload : (payload.tasks ?? []));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to read task event");
      }
    };
    const handleTaskAlert = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as AlertState;
        if (payload.taskId && payload.name) {
          triggerAlert(payload);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to read task alert");
      }
    };
    const handleTaskDismiss = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { taskId?: string };
        if (payload.taskId) {
          void dismissAlert({ post: false, taskId: payload.taskId });
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to read task dismissal");
      }
    };
    const handleDashboardError = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { message?: string };
        if (payload.message) {
          setMessage(payload.message);
        }
      } catch {
        setMessage("Dashboard event error");
      }
    };

    events.addEventListener("tasks", handleTasks as EventListener);
    events.addEventListener("task-alert", handleTaskAlert as EventListener);
    events.addEventListener("task-dismiss", handleTaskDismiss as EventListener);
    events.addEventListener("dashboard-error", handleDashboardError as EventListener);

    return () => {
      events.removeEventListener("tasks", handleTasks as EventListener);
      events.removeEventListener("task-alert", handleTaskAlert as EventListener);
      events.removeEventListener("task-dismiss", handleTaskDismiss as EventListener);
      events.removeEventListener("dashboard-error", handleDashboardError as EventListener);
      events.close();
    };
  }, [dismissAlert, triggerAlert]);

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
    if (!alert) {
      return;
    }

    document.body.classList.add("task-alerting");
    startAudioCadence();

    return () => {
      document.body.classList.remove("task-alerting");
      clearAudioCadence();
    };
  }, [alert, clearAudioCadence, startAudioCadence]);

  useEffect(() => {
    if (!alert) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void dismissAlert({ post: true });
    };

    document.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true });
    };
  }, [alert, dismissAlert]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("task-alerting");
      clearAudioCadence();
    };
  }, [clearAudioCadence]);

  const activeTask = useMemo(
    () => tasks.filter((task) => isTaskActive(task, nowMs)).sort((left, right) => taskStartMs(left) - taskStartMs(right))[0] ?? null,
    [nowMs, tasks],
  );

  const visibleTasks = useMemo(() => {
    const today = startOfLocalDay(new Date(nowMs));
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    return tasks
      .filter((task) => taskEndMs(task) >= today.getTime())
      .filter((task) => {
        const start = new Date(task.start);
        if (tab === "today") {
          return isSameLocalDay(start, today);
        }
        return taskStartMs(task) >= tomorrow.getTime();
      })
      .sort((left, right) => taskStartMs(left) - taskStartMs(right));
  }, [nowMs, tab, tasks]);

  const selectedCount = selectedTaskIds.size;

  const saveNewTask = async (draft: { name: string; start: string; end: string }) => {
    setBusyId("create");
    try {
      await jsonFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setCreateOpen(false);
      setCreateDraft(defaultDraft());
      setMessage("Task added");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add task");
    } finally {
      setBusyId(null);
    }
  };

  const saveTask = async (task: Task, draft: { name: string; start: string; end: string }) => {
    setBusyId(task.id);
    try {
      await jsonFetch<Task>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      setExpandedTaskId(null);
      setMessage("Task saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save task");
    } finally {
      setBusyId(null);
    }
  };

  const convertTaskToLocal = async (task: Task) => {
    setBusyId(task.id);
    try {
      await jsonFetch<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ name: task.name, start: task.start, end: task.end }),
      });
      await jsonFetch<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "DELETE",
      });
      setExpandedTaskId(null);
      setMessage("Converted to local");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to convert task");
    } finally {
      setBusyId(null);
    }
  };

  const deleteSelected = async () => {
    if (!selectedCount) {
      return;
    }
    if (!window.confirm(`Delete ${selectedCount} selected task${selectedCount === 1 ? "" : "s"}?`)) {
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
      setMessage("Selected tasks deleted");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete selected tasks");
    } finally {
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

  return (
    <>
      <CurrentTaskChip task={activeTask} />

      {alert ? (
        <>
          <div className="task-alert-overlay" aria-hidden="true" />
          <div className="task-alert-banner" role="alert">
            <Bell className="h-5 w-5" />
            <span className="min-w-0 flex-1 truncate">{alert.name}</span>
            <button
              className="inline-flex min-h-9 items-center gap-2 border border-cyan-300/60 px-3 py-1 text-xs font-black"
              type="button"
              onClick={() => void dismissAlert({ post: true })}
            >
              <BellOff className="h-4 w-4" />
              Dismiss
            </button>
          </div>
        </>
      ) : null}

      <audio ref={audioRef} src={ALERT_AUDIO_PATH} preload="auto" />

      <section className="tasks-panel border border-neutral-700 bg-neutral-950/70 p-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase text-cyan-300">Schedule</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-neutral-50">Tasks</h2>
          </div>
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
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-grid grid-cols-2 border border-neutral-700">
            {(["today", "upcoming"] as TaskTab[]).map((candidate) => (
              <button
                key={candidate}
                className={classNames(
                  "min-h-10 px-4 py-2 text-sm font-black uppercase",
                  tab === candidate && "bg-cyan-300/10 text-cyan-100",
                )}
                type="button"
                onClick={() => setTab(candidate)}
              >
                {candidate === "today" ? "Today" : "Upcoming"}
              </button>
            ))}
          </div>

          {editMode ? (
            <button
              className="inline-flex min-h-10 items-center gap-2 border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm font-black text-red-100"
              type="button"
              onClick={() => void deleteSelected()}
              disabled={!selectedCount || busyId === "delete"}
            >
              <Trash2 className="h-4 w-4" />
              Delete ({selectedCount})
            </button>
          ) : null}
        </div>

        {message ? (
          <div className="mb-3 border border-cyan-300/40 bg-cyan-300/10 p-2 font-mono text-sm font-black uppercase text-cyan-100">
            {message}
          </div>
        ) : null}

        <div className="grid gap-3">
          {createOpen ? (
            <TaskEditor
              busy={busyId === "create"}
              initial={createDraft}
              onCancel={() => setCreateOpen(false)}
              onSave={saveNewTask}
              submitLabel="Create"
            />
          ) : null}

          {visibleTasks.length ? (
            visibleTasks.map((task) => {
              const status = statusForTask(task, nowMs);
              const selected = selectedTaskIds.has(task.id);
              const expanded = expandedTaskId === task.id;

              return (
                <div key={task.id} className="grid gap-2">
                  <button
                    className={classNames(
                      "task-row grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-neutral-700 bg-neutral-950/70 p-3 text-left",
                      selected && "border-cyan-300/60 bg-cyan-300/10",
                    )}
                    type="button"
                    onClick={() => rowClick(task)}
                  >
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
                        {task.sourceCalendar ? (
                          <p className="mt-1 truncate font-mono text-xs font-black uppercase text-neutral-500">
                            {sourceLabel(task.source)} / {task.sourceCalendar}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={classNames(
                        "whitespace-nowrap border px-2 py-1 font-mono text-xs font-black uppercase",
                        statusClassName(status),
                      )}
                    >
                      {status}
                    </span>
                  </button>

                  {expanded && !editMode ? (
                    task.readOnly || task.source !== "local" ? (
                      <ReadOnlyTaskPanel busy={busyId === task.id} onConvert={convertTaskToLocal} task={task} />
                    ) : (
                      <TaskEditor
                        busy={busyId === task.id}
                        initial={taskDraft(task)}
                        onCancel={() => setExpandedTaskId(null)}
                        onSave={(draft) => saveTask(task, draft)}
                        submitLabel="Save"
                      />
                    )
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="border border-neutral-700 bg-neutral-950/70 p-4 font-mono text-sm font-black uppercase text-neutral-500">
              No {tab === "today" ? "tasks today" : "upcoming tasks"}
            </div>
          )}
        </div>
      </section>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}
