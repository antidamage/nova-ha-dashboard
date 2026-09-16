import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Task } from "../../../lib/types";
import { washReminder } from "../../../lib/wash-reminder";
import { useDeviceTheme } from "../accentColor";
import { resolveUxSoundUrl } from "../dashboard/controlSound";
import { useReminderBannerSetting } from "../dashboard/reminderBannerSetting";
import { useOrbSettings } from "../orb-info/useOrbSettings";
import { loadSharedClientConfig, readCachedClientConfig } from "../sharedConfigCache";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
import { ALERT_AUDIO_REPEAT_MS, ALERT_AUDIO_WINDOW_MS } from "./constants";
import { alertAudioTimingFromConfig } from "./panel-model";
import { jsonFetch } from "./task-api";
import {
  hasTaskAlertChimed,
  isTaskAlerting,
  isTaskAlertSilenced,
  isTaskAnnoyer,
  isTaskComplete,
  shouldClearTaskAlert,
  taskAlertSessionKey,
  taskStartMs,
  type AlertState,
} from "./task-model";
import type { TaskAudioStatus } from "./types";

/**
 * The Reminders panel's alert machine: task loading and pushes, the alert
 * banner state, the chime cadence and its household-wide claim. The body is
 * TasksPanel's, moved as one block; the panel passes in the state it declares
 * before this point.
 */
export function useTaskAlerts({
  nowMs,
  setMessage,
  setNowMs,
  setTasks,
  setTasksLoaded,
  tasks,
  tasksLoaded,
}: {
  nowMs: number;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setNowMs: Dispatch<SetStateAction<number>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setTasksLoaded: Dispatch<SetStateAction<boolean>>;
  tasks: Task[];
  tasksLoaded: boolean;
}) {
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

  return {
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
  };
}
