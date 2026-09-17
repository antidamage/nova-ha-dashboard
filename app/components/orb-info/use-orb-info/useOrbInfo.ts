"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orbModuleById } from "../../../../lib/orb-info/catalogue";
import { formatOrbValue, msUntilDisplayChange } from "../../../../lib/orb-info/format";
import { resolveOrbDisplay, resolveOrbEntries, resolveOrbParams } from "../../../../lib/orb-info/preferences";
import type {
  OrbInfoPreferences,
  OrbInfoSources,
  OrbModuleOutput,
  OrbSourceId,
} from "../../../../lib/orb-info/types";
import { useOrbTimer } from "../useOrbTimer";
import { orderOrbStack } from "../../../../lib/orb-info/stack";
import type { Task } from "../../../../lib/types";
import { applyTaskDismissal, dismissalKey, tasksSourceFrom } from "./source-model";
import type { DashboardSource, NovaLoadSample, OrbStackView, PowerSource, UseOrbInfoOptions, WatchfaceSource } from "./types";
import { useDashboardFeed, usePowerFeed, usePreferencesFeed, useTasksFeed, useWatchfaceFeed } from "./useSourceFeeds";

/**
 * The browser half of the status orb info modules: it owns the polling, and
 * subscribes to EXACTLY the sources the selected module declares. Selecting
 * "None" or the clock starts no network traffic at all.
 */

export function useOrbInfo({
  enabled,
  moduleIdOverride,
  displayOverride,
  paramsOverride,
}: UseOrbInfoOptions) {
  const [preferences, setPreferences] = useState<OrbInfoPreferences | undefined>(undefined);
  const [watchface, setWatchface] = useState<WatchfaceSource>(null);
  const [washing, setWashing] = useState<OrbInfoSources["washing"]>(null);
  const [events, setEvents] = useState<OrbInfoSources["events"]>({});
  const [power, setPower] = useState<PowerSource>(null);
  const [dashboard, setDashboard] = useState<DashboardSource>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [novaLoad, setNovaLoad] = useState<NovaLoadSample | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  // Dismissals this screen has sent: hidden at once, before the broadcast returns.
  const [locallyDismissed, setLocallyDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const entries = useMemo(() => moduleIdOverride !== undefined
    ? [{ id: "preview", moduleId: moduleIdOverride, enabled: true,
        display: displayOverride, params: paramsOverride }]
    : resolveOrbEntries(preferences), [preferences, moduleIdOverride, displayOverride, paramsOverride]);
  const neededSources = useMemo(() => new Set(entries.flatMap((entry) => orbModuleById(entry.moduleId).sources)), [entries]);
  const needs = useCallback(
    (source: OrbSourceId) => enabled && neededSources.has(source),
    [enabled, neededSources],
  );
  const needsWatchface = needs("watchface");
  const needsPower = needs("power");
  const needsDashboard = needs("dashboardState");
  const needsNovaLoad = needs("novaLoad");
  const needsTasks = needs("tasks");
  const { timer: orbTimer, now: timerNow, command: timerCommand } = useOrbTimer(needs("orbTimer"));

  // ---- Which module is selected, and how it is displayed -------------------
  usePreferencesFeed({ enabled, moduleIdOverride, displayOverride, setPreferences });

  // ---- Watchface (the gym scraper's output) --------------------------------
  useWatchfaceFeed(needsWatchface, setWatchface);

  // ---- Power ---------------------------------------------------------------
  usePowerFeed(needsPower, setWashing, setPower);

  // ---- Dashboard state (weather, sun, entity counts) -----------------------
  useDashboardFeed(needsDashboard, setDashboard);

  // ---- Reminders -----------------------------------------------------------
  useTasksFeed(needsTasks, setTasks);

  const needsEvents = needs("orbEvents");
  const entriesKey = JSON.stringify(entries);
  useEffect(() => {
    if (!needsEvents) return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/orb-info/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) });
        if (response.ok) { const data = await response.json(); if (alive) setEvents(data.outputs); }
      } catch { /* next poll recovers */ }
    };
    void load(); const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  // The serialized entry list avoids polling resets from equivalent preferences.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsEvents, entriesKey]);
  useEffect(() => {
    if (!enabled || !neededSources.has("clock")) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled, neededSources]);

  const sources = useMemo<OrbInfoSources>(() => ({
    now: needs("orbTimer") ? timerNow : tick,
    orbTimer, washing, washTasks: tasks ?? [], events,
    watchface: needsWatchface ? watchface : null,
    novaLoad: needsNovaLoad ? novaLoad : null,
    power: needsPower ? power : null,
    dashboardState: needsDashboard ? dashboard : null,
    tasks: needsTasks && tasks ? tasksSourceFrom(tasks, tick) : null,
  }), [
    washing, events, orbTimer, timerNow, needs, tick, needsWatchface, watchface, needsNovaLoad, novaLoad, needsPower, power,
    needsDashboard, dashboard, needsTasks, tasks,
  ]);

  const outputs = Object.fromEntries(entries.map((entry) => [entry.id,
    orbModuleById(entry.moduleId).read(sources, entry.params)]));
  // First-seen time for alerts whose module carries no timestamp of its own.
  const alertSinceRef = useRef<Record<string, number>>({});
  for (const entry of entries) {
    if (outputs[entry.id]?.alert) alertSinceRef.current[entry.id] ??= Date.now();
    else delete alertSinceRef.current[entry.id];
  }
  const ordered = orderOrbStack(entries, outputs, alertSinceRef.current)
    .filter((item) => !(item.output.dismiss && locallyDismissed.has(dismissalKey(item.output))));
  const selected = ordered[0] ?? null;
  const module = orbModuleById(selected?.entry.moduleId ?? "none");
  const entryPreferences = { modules: { [module.id]: selected?.entry ?? {} } };
  const display = resolveOrbDisplay(entryPreferences, module.id);
  const params = resolveOrbParams(entryPreferences, module.id);
  const outputValue = selected?.output ?? module.read(sources, params);
  const result = formatOrbValue(outputValue, display, { label: module.label });

  // Hidden rows must also wake: an alert threshold can promote them to first place.
  const changes = entries.map((entry) => msUntilDisplayChange(outputs[entry.id],
    resolveOrbDisplay({ modules: { [entry.moduleId]: entry } }, entry.moduleId), tick))
    .filter((value): value is number => value !== null);
  const nextChangeMs = enabled && changes.length ? Math.min(...changes) : null;
  useEffect(() => {
    if (nextChangeMs === null) return;
    const id = window.setTimeout(() => setTick(Date.now()), nextChangeMs);
    return () => window.clearTimeout(id);
  }, [nextChangeMs, tick]);

  /**
   * Fed by the orb's existing 2s /api/nova-load poll rather than a second one.
   * The sample is dropped unless a host module is selected, and stored only
   * when the value would actually redraw — the load poll deliberately avoids
   * React state (see POLL_MS in NovaAvatar), and this keeps that property.
   */
  const displayRef = useRef(display);
  displayRef.current = display;
  const ingestNovaLoad = useCallback((sample: NovaLoadSample) => {
    if (!needsNovaLoad) return;
    setNovaLoad((current) => {
      if (!current) return sample;
      const decimals = displayRef.current.decimals;
      const changed = (["cpu", "gpu", "net", "load"] as const).some(
        (key) => current[key].toFixed(decimals + 2) !== sample[key].toFixed(decimals + 2),
      );
      return changed || current.listening !== sample.listening ? sample : current;
    });
  }, [needsNovaLoad]);

  const dismissTarget = useCallback(async (output: Pick<OrbModuleOutput, "dismiss" | "alertAt">) => {
    const target = output.dismiss;
    if (!target) return;
    // Keyed per occurrence, so the next occurrence of a repeating reminder still shows.
    const key = dismissalKey(output);
    setLocallyDismissed((current) => new Set(current).add(key));
    try {
      if (target.kind === "timer") await timerCommand({ command: "dismiss", id: target.id });
      else {
        const response = await fetch(`/api/tasks/${encodeURIComponent(target.id)}/dismiss`, { method: "POST" });
        if (!response.ok) throw new Error("Dismiss failed");
        setTasks((current) => current && applyTaskDismissal(current, target.id));
      }
    } catch (error) {
      // Let the alert come back so the tap can be retried.
      setLocallyDismissed((current) => { const next = new Set(current); next.delete(key); return next; });
      throw error;
    }
  }, [timerCommand]);

  const stack: OrbStackView[] = ordered.map((item) => {
    const itemModule = orbModuleById(item.entry.moduleId);
    const itemDisplay = resolveOrbDisplay({ modules: { [itemModule.id]: item.entry } }, itemModule.id);
    const formatted = formatOrbValue(item.output, itemDisplay, { label: itemModule.label });
    return { entry: item.entry, state: item.state, module: itemModule, output: item.output, text: formatted.text,
      alert: formatted.alert || item.state === "alert", ariaLabel: formatted.ariaLabel };
  });

  return {
    dismiss: outputValue.dismiss ? () => dismissTarget(outputValue) : undefined,
    /** Dismiss a specific stack item's alert everywhere. */
    dismissTarget,
    /** The full ordered stack for the dial; index 0 is what the orb shows at rest. */
    stack,
    module,
    display,
    params,
    /** Zones and sensors the config page offers as parameter choices. */
    zoneChoices: dashboard?.zones ?? [],
    entityChoices: dashboard?.numericEntities ?? [],
    output: outputValue,
    text: result.text,
    alert: result.alert,
    ariaLabel: result.ariaLabel,
    ingestNovaLoad,
    /** True when the module renders nothing at all (the "None" selection). */
    empty: module.id === "none",
  };
}
