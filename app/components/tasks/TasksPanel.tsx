"use client";

import { Check, Circle, CircleCheck, Download, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReminderGlyph } from "../../../lib/reminder-glyph";
import type { Task } from "../../../lib/types";
import { washReminder } from "../../../lib/wash-reminder";
import { AdvancedFold } from "../dashboard/AdvancedFold";
import { useModuleIntercepts } from "../modules/ModuleHost";
import { OrbCompletionAudio } from "../orb-info/OrbCompletionAudio";
import { TimerEncoder } from "../TimerEncoder";
import { CurrentTaskBar } from "./CurrentTaskBar";
import { ExportModal } from "./ExportModal";
import { ImportModal } from "./ImportModal";
import { classNames } from "./panel-model";
import { ReadOnlyTaskPanel } from "./ReadOnlyTaskPanel";
import {
  glyphWriteForSave,
  loadRosterGlyphs,
  writeReminderGlyph,
  type RosterGlyphs,
} from "./reminder-roster-client";
import { jsonFetch } from "./task-api";
import { TaskEditor } from "./TaskEditor";
import { TaskLists } from "./TaskLists";
import {
  defaultDraft,
  followsLabel,
  isTaskCurrent,
  repeatLabel,
  sourceLabel,
  statusClassName,
  statusForTask,
  taskDraft,
  taskStartMs,
  timeRange,
  type TaskDraft,
  type TaskEditorSaveDraft,
} from "./task-model";
import { TasksAdvanced } from "./TasksAdvanced";
import { TaskSourceIcon } from "./TaskSourceIcon";
import { useTaskAlerts } from "./useTaskAlerts";

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
  const {
    alert,
    alertRef,
    audioRef,
    bannersEnabled,
    clearAlert,
    dismissAlert,
    dismissingTaskIds,
    hasWashing,
    reminderAlertUrl,
    taskAudioExists,
    washAlertId,
  } = useTaskAlerts({ nowMs, setMessage, setNowMs, setTasks, setTasksLoaded, tasks, tasksLoaded });

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
