"use client";

import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { OrbInfoDisplay, OrbInfoPreferences, OrbInfoSources } from "../../../../lib/orb-info/types";
import type { DashboardState, Task } from "../../../../lib/types";
import { subscribeToDashboardEvents } from "../../sharedDashboardEvents";
import { ORB_INFO_CHANGE_EVENT, POWER_POLL_MS, PREFERENCES_POLL_MS, WATCHFACE_POLL_MS } from "./constants";
import { applyTaskDismissal, dashboardSourceFrom, millisFromIso, numberOrNull } from "./source-model";
import type { DashboardSource, PowerSource, WatchfaceSource } from "./types";

/*
 * The source feeds behind `useOrbInfo`, one hook per source. Each is a single
 * effect moved verbatim, called by `useOrbInfo` exactly where the effect used to
 * run, so hook order is unchanged. The setters come from `useOrbInfo`'s state.
 */

/** Which module is selected, and how it is displayed. */
export function usePreferencesFeed({
  enabled,
  moduleIdOverride,
  displayOverride,
  setPreferences,
}: {
  enabled: boolean;
  moduleIdOverride?: string;
  displayOverride?: OrbInfoDisplay;
  setPreferences: Dispatch<SetStateAction<OrbInfoPreferences | undefined>>;
}) {
  useEffect(() => {
    // A preview drives everything from props; it must never poll or be
    // overwritten by the saved configuration.
    if (!enabled || (moduleIdOverride !== undefined && displayOverride !== undefined)) return;
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/orb-info", { cache: "no-store" });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const data = await response.json() as { orbInfo?: OrbInfoPreferences };
        if (alive) setPreferences(data.orbInfo);
      } catch (error) {
        console.error("[nova-dashboard] failed to load status orb info settings", error);
      }
    };

    void load();
    const id = window.setInterval(load, PREFERENCES_POLL_MS);
    // Saving on the config page force-publishes state; picking that up here
    // makes the orb reflect an edit immediately instead of within a minute.
    const unsubscribe = subscribeToDashboardEvents({
      state: (event) => {
        try {
          const payload = JSON.parse(event.data) as DashboardState;
          if (alive && payload.preferences?.orbInfo) setPreferences(payload.preferences.orbInfo);
        } catch {
          // Malformed frame; the poll above is the backstop.
        }
      },
    });
    const onLocalChange = () => void load();
    window.addEventListener(ORB_INFO_CHANGE_EVENT, onLocalChange);

    return () => {
      alive = false;
      window.clearInterval(id);
      unsubscribe();
      window.removeEventListener(ORB_INFO_CHANGE_EVENT, onLocalChange);
    };
  }, [enabled, moduleIdOverride, displayOverride]);
}

/** Watchface (the gym scraper's output). */
export function useWatchfaceFeed(
  needsWatchface: boolean,
  setWatchface: Dispatch<SetStateAction<WatchfaceSource>>,
) {
  useEffect(() => {
    if (!needsWatchface) return;
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/watchface", { cache: "no-store" });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const data = await response.json() as {
          watchface?: { gymLastResetAt?: string; gymAlertThresholdHours?: number };
        };
        if (!alive) return;
        setWatchface({
          gymLastResetAt: millisFromIso(data.watchface?.gymLastResetAt),
          gymAlertThresholdHours: numberOrNull(data.watchface?.gymAlertThresholdHours),
        });
      } catch (error) {
        console.error("[nova-dashboard] failed to sync gym counter", error);
      }
    };

    void load();
    const id = window.setInterval(load, WATCHFACE_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [needsWatchface]);
}

/** Power, and the washing machine reading that rides on it. */
export function usePowerFeed(
  needsPower: boolean,
  setWashing: Dispatch<SetStateAction<OrbInfoSources["washing"]>>,
  setPower: Dispatch<SetStateAction<PowerSource>>,
) {
  useEffect(() => {
    if (!needsPower) return;
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch("/api/power", { cache: "no-store" });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const data = await response.json() as {
          washingMachine?: OrbInfoSources["washing"];
          currentWatts?: number;
          currentCostPerHourNzd?: number;
          generatedAt?: string;
        };
        if (!alive) return;
        setWashing(data.washingMachine);
        setPower({
          currentWatts: numberOrNull(data.currentWatts),
          currentCostPerHourNzd: numberOrNull(data.currentCostPerHourNzd),
          generatedAt: data.generatedAt ?? null,
        });
      } catch (error) {
        console.error("[nova-dashboard] failed to sync orb power reading", error);
      }
    };

    void load();
    const id = window.setInterval(load, POWER_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [needsPower]);
}

/** Dashboard state (weather, sun, entity counts). */
export function useDashboardFeed(
  needsDashboard: boolean,
  setDashboard: Dispatch<SetStateAction<DashboardSource>>,
) {
  useEffect(() => {
    if (!needsDashboard) return;
    let alive = true;

    // Ride the SHARED SSE stream rather than opening a second one; the snapshot
    // fetch below only covers the gap before the first push arrives.
    const unsubscribe = subscribeToDashboardEvents({
      state: (event) => {
        try {
          const payload = JSON.parse(event.data) as DashboardState;
          if (alive) setDashboard(dashboardSourceFrom(payload));
        } catch {
          // Ignore a malformed frame; the next push replaces it.
        }
      },
    });

    void (async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const payload = await response.json() as DashboardState;
        // Don't clobber a push that landed while this was in flight.
        if (alive) setDashboard((current) => current ?? dashboardSourceFrom(payload));
      } catch (error) {
        console.error("[nova-dashboard] failed to seed orb dashboard reading", error);
      }
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [needsDashboard]);
}

/** Reminders. */
export function useTasksFeed(
  needsTasks: boolean,
  setTasks: Dispatch<SetStateAction<Task[] | null>>,
) {
  useEffect(() => {
    if (!needsTasks) return;
    let alive = true;

    const unsubscribe = subscribeToDashboardEvents({
      tasks: (event) => {
        try {
          const payload = JSON.parse(event.data) as { tasks?: Task[] };
          if (alive && Array.isArray(payload.tasks)) setTasks(payload.tasks);
        } catch {
          // Ignore a malformed frame; the next push replaces it.
        }
      },
      // A dismissal on another screen clears this orb's alert at once, without
      // waiting for (or depending on) the full task list push.
      "task-dismiss": (event) => {
        try {
          const { taskId } = JSON.parse(event.data) as { taskId?: string };
          if (alive && taskId) setTasks((current) => current && applyTaskDismissal(current, taskId));
        } catch {
          // Ignore a malformed frame.
        }
      },
    });

    void (async () => {
      try {
        const response = await fetch("/api/tasks?command=list", { cache: "no-store" });
        if (!response.ok) {
          await response.body?.cancel();
          return;
        }
        const payload = await response.json() as { tasks?: Task[] };
        if (alive && Array.isArray(payload.tasks)) setTasks((current) => current ?? payload.tasks!);
      } catch (error) {
        console.error("[nova-dashboard] failed to seed orb reminder reading", error);
      }
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [needsTasks]);
}
