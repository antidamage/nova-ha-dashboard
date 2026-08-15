"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { orbModuleById, type OrbInfoSources } from "../../../lib/orb-info/catalogue";
import { formatOrbValue, msUntilDisplayChange } from "../../../lib/orb-info/format";
import { resolveOrbDisplay, resolveOrbModuleId } from "../../../lib/orb-info/preferences";
import type { OrbInfoDisplay, OrbInfoPreferences, OrbSourceId } from "../../../lib/orb-info/types";
import type { DashboardState } from "../../../lib/types";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";

/**
 * The browser half of the status orb info modules: it owns the polling, and
 * subscribes to EXACTLY the sources the selected module declares. Selecting
 * "None" or the clock starts no network traffic at all.
 */

const PREFERENCES_POLL_MS = 60_000;
const WATCHFACE_POLL_MS = 5 * 60 * 1000;
const POWER_POLL_MS = 30_000;

export const ORB_INFO_CHANGE_EVENT = "nova-orb-info-change";

type WatchfaceSource = OrbInfoSources["watchface"];
type PowerSource = OrbInfoSources["power"];
type DashboardSource = OrbInfoSources["dashboardState"];
export type NovaLoadSample = NonNullable<OrbInfoSources["novaLoad"]>;

function millisFromIso(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Project the heavy dashboard state down to the few fields modules read. */
export function dashboardSourceFrom(state: DashboardState | null): DashboardSource {
  if (!state) return null;
  const entities = state.entities ?? [];
  return {
    outsideTemperature: numberOrNull(state.weather?.temperature),
    outsideFeelsLike: numberOrNull(state.weather?.feelsLike),
    humidity: numberOrNull(state.weather?.humidity),
    rainChancePct: numberOrNull(state.weather?.rainChancePct),
    nextSetting: state.sun?.nextSetting ?? null,
    nextRising: state.sun?.nextRising ?? null,
    sunState: state.sun?.state ?? null,
    haHealthy: state.haHealth ? state.haHealth.status === "ok" : true,
    lightsOn: entities.filter((entity) => entity.domain === "light" && entity.state === "on").length,
    unavailableCount: entities.filter((entity) => entity.state === "unavailable").length,
    generatedAt: state.generatedAt ?? null,
  };
}

export type UseOrbInfoOptions = {
  /** False while the orb is hidden or opted out — stops every source. */
  enabled: boolean;
  /** Config previews drive the module and display directly. */
  moduleIdOverride?: string;
  displayOverride?: OrbInfoDisplay;
};

export function useOrbInfo({ enabled, moduleIdOverride, displayOverride }: UseOrbInfoOptions) {
  const [preferences, setPreferences] = useState<OrbInfoPreferences | undefined>(undefined);
  const [watchface, setWatchface] = useState<WatchfaceSource>(null);
  const [power, setPower] = useState<PowerSource>(null);
  const [dashboard, setDashboard] = useState<DashboardSource>(null);
  const [novaLoad, setNovaLoad] = useState<NovaLoadSample | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  const moduleId = moduleIdOverride ?? resolveOrbModuleId(preferences);
  const module = orbModuleById(moduleId);
  const display = displayOverride ?? resolveOrbDisplay(preferences, module.id);

  const needs = useCallback(
    (source: OrbSourceId) => enabled && module.sources.includes(source),
    [enabled, module],
  );
  const needsWatchface = needs("watchface");
  const needsPower = needs("power");
  const needsDashboard = needs("dashboardState");
  const needsNovaLoad = needs("novaLoad");

  // ---- Which module is selected, and how it is displayed -------------------
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

  // ---- Watchface (the gym scraper's output) --------------------------------
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

  // ---- Power ---------------------------------------------------------------
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
          currentWatts?: number;
          currentCostPerHourNzd?: number;
          generatedAt?: string;
        };
        if (!alive) return;
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

  // ---- Dashboard state (weather, sun, entity counts) -----------------------
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

  const sources = useMemo<OrbInfoSources>(() => ({
    now: tick,
    watchface: needsWatchface ? watchface : null,
    novaLoad: needsNovaLoad ? novaLoad : null,
    power: needsPower ? power : null,
    dashboardState: needsDashboard ? dashboard : null,
  }), [tick, needsWatchface, watchface, needsNovaLoad, novaLoad, needsPower, power, needsDashboard, dashboard]);

  const outputValue = module.read(sources);
  const result = formatOrbValue(outputValue, display, { label: module.label });

  // ---- Wake exactly when the rendered text would change ---------------------
  const nextChangeMs = enabled ? msUntilDisplayChange(outputValue, display, tick) : null;
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

  return {
    module,
    display,
    output: outputValue,
    text: result.text,
    alert: result.alert,
    ariaLabel: result.ariaLabel,
    ingestNovaLoad,
    /** True when the module renders nothing at all (the "None" selection). */
    empty: module.id === "none",
  };
}
