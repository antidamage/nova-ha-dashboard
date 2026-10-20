"use client";

import { useEffect, useState } from "react";
import type { Task } from "../../../../lib/types";
import { subscribeToDashboardEvents } from "../../sharedDashboardEvents";
import { REMINDER_ICONS_CHANGED_EVENT } from "../../tasks/reminder-roster-client";
import { parseRoster } from "./tile-model";
import type { RosterEntry } from "./types";

/**
 * The bar's data feed: the initial fetch of tasks and the icon roster, then the
 * SSE and roster-changed event updates. Moved out of ReminderIconBar as is.
 */
export function useReminderFeed() {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // Until the roster has been fetched we do not know whether there will be
  // tiles, so the bar holds its height rather than popping in and shoving the
  // whole dashboard down. Only once we know the row is genuinely empty does it
  // collapse.
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Initial load. SSE carries every later change, but the stream only pushes on
  // change — and the static demo build has no real stream at all — so the first
  // paint has to come from a plain fetch, exactly as TasksPanel does.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [taskResponse, iconResponse] = await Promise.all([
          fetch("/api/tasks?command=list", { cache: "no-store" }),
          fetch("/api/reminders/icons", { cache: "no-store" }),
        ]);

        if (cancelled) {
          return;
        }
        if (taskResponse.ok) {
          const payload = (await taskResponse.json()) as { tasks?: Task[] };
          setTasks(payload.tasks ?? []);
        }
        if (iconResponse.ok) {
          setRoster(parseRoster(await iconResponse.text()));
        }
      } catch {
        // No bar is the correct failure mode here: the reminders panel owns
        // telling the user the feed is broken.
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    // The Reminders editor writes the roster from this screen and says so, so
    // the tile changes even where the stream is absent (the static demo).
    const reload = () => {
      fetch("/api/reminders/icons", { cache: "no-store" })
        .then((response) => (response.ok ? response.text() : null))
        .then((text) => {
          if (text !== null) setRoster(parseRoster(text));
        })
        .catch(() => undefined);
    };
    window.addEventListener(REMINDER_ICONS_CHANGED_EVENT, reload);

    const unsubscribe = subscribeToDashboardEvents({
      tasks: (event) => {
        try {
          const payload = JSON.parse(event.data) as { tasks?: Task[] } | Task[];
          setTasks(Array.isArray(payload) ? payload : (payload.tasks ?? []));
        } catch {
          // The panel surfaces reminder feed errors; the bar just holds its
          // last-known-good row rather than blanking.
        }
      },
      "reminder-icons": (event) => {
        try {
          setRoster(parseRoster(event.data));
        } catch {
          // As above — keep the tiles we already have.
        }
      },
    });

    return () => {
      window.removeEventListener(REMINDER_ICONS_CHANGED_EVENT, reload);
      unsubscribe();
    };
  }, []);

  return { loaded, roster, tasks };
}
