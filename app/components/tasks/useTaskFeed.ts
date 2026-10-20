import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Task } from "../../../lib/types";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
import { jsonFetch } from "./task-api";
import type { AlertState } from "./task-model";
import type { TaskAudioStatus } from "./types";

/**
 * The Reminders panel's task feed, moved out of useTaskAlerts as is: the
 * fetch-and-refresh loader and the server-sent-event subscription. Both share
 * `taskPushRevision`, which lets a push outrank a fetch that was in flight.
 */
type FeedSetters = {
  setMessage: Dispatch<SetStateAction<string | null>>;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setTasksLoaded: Dispatch<SetStateAction<boolean>>;
  taskPushRevision: MutableRefObject<number>;
};

export function useTaskListLoader({ setMessage, setTasks, setTasksLoaded, taskPushRevision }: FeedSetters) {
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
}

export function useTaskAlertEvents({
  dismissAlert,
  setMessage,
  setTasks,
  setTaskAudioExists,
  setTasksLoaded,
  taskPushRevision,
  triggerAlert,
}: FeedSetters & {
  dismissAlert: (options: { post?: boolean; taskId?: string; updateTask?: boolean }) => Promise<void>;
  setTaskAudioExists: Dispatch<SetStateAction<boolean>>;
  triggerAlert: (alert: AlertState) => void;
}) {
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
}
