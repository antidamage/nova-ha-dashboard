"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Settings, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DashboardState, DashboardZone } from "../../lib/types";
import {
  AIRCON_AUTO_POLL_MS,
  AirconAutoThermostat,
  airconAutoMeasuredTemperature,
  type EntityActionInput,
} from "../../lib/aircon-control";
import { useDeviceTheme } from "./accentColor";
import { ClockPanel } from "./dashboard/ClockPanel";
import { ZoneControls } from "./dashboard/ZoneControls";
import { ZoneButton } from "./dashboard/ZoneButton";
import { LIGHT_COMMAND_POLL_HOLD_MS } from "./dashboard/lighting";
import { preloadRadarTiles, RADAR_REFRESH_INTERVAL_MS } from "./dashboard/radar";
import {
  climateDevicesForZone,
  classNames,
  findBedroomPanelHeaterTemperature,
  findLoungeEnvironment,
  isClimateZone,
  isOutsideZone,
  TASKS_ZONE,
  TASKS_ZONE_ID,
} from "./dashboard/shared";
import {
  entityActionsAffectLightPolling,
  fetchDashboardStateSnapshot,
  isLightZoneAction,
  optimisticStateForEntityActions,
  optimisticStateForZoneAction,
  useDashboardState,
} from "./dashboard/state";
import {
  removeLegacySelectedZoneParam,
  requestDashboardFullscreen,
  selectedZoneIdFromStorage,
  writeSelectedZoneToStorage,
} from "./dashboard/shell";
import { TasksPanel } from "./TasksPanel";
import { useBuildReload } from "./useBuildReload";

const ENTITY_COMMAND_HOLD_MS = 2000;
const CLIMATE_COMMAND_POLL_DELAYS_MS = [ENTITY_COMMAND_HOLD_MS + 100];

function buildZoneTree(data: DashboardState | null) {
  const zones = data?.zones ?? [];
  const inside = zones.find((zone) => zone.id === "everything") ?? null;
  const climate = zones.find(isClimateZone) ?? null;
  const outside = zones.find(isOutsideZone) ?? null;

  return {
    inside,
    climate,
    indoor: zones.filter((zone) => zone.id !== inside?.id && zone.id !== climate?.id && zone.id !== outside?.id),
    outside,
  };
}

function Warnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {warnings.map((warning) => (
        <span
          key={warning}
          className="border border-yellow-300/50 bg-yellow-300/10 px-3 py-2 text-xs font-black uppercase text-yellow-100"
        >
          {warning}
        </span>
      ))}
    </div>
  );
}

function ZonesPanel({
  data,
  selectedZone,
  selectedZoneId,
  zones,
  onSelectZone,
}: {
  data: DashboardState | null;
  selectedZone: DashboardZone | null;
  selectedZoneId: string;
  zones: ReturnType<typeof buildZoneTree>;
  onSelectZone: (zoneId: string) => void;
}) {
  const tasksZoneSelected = selectedZoneId === TASKS_ZONE_ID;

  return (
    <aside className="zones-panel border border-neutral-700 bg-neutral-950/70 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-black uppercase text-neutral-100">Zones</h2>
        <Zap className="h-5 w-5 text-yellow-300" />
      </div>
      <div className="grid gap-3">
        {zones.inside ? (
          <div className={classNames("zone-tree", zones.indoor.length > 0 && "zone-parent-widget")}>
            <ZoneButton
              zone={zones.inside}
              selected={selectedZone?.id === zones.inside.id}
              onClick={() => onSelectZone(zones.inside!.id)}
              hideCounts={zones.indoor.length > 0}
            />

            {zones.indoor.length ? (
              <div className="zone-children mt-3 grid gap-3">
                {zones.indoor.map((zone) => (
                  <ZoneButton
                    key={zone.id}
                    zone={zone}
                    nested
                    selected={selectedZone?.id === zone.id}
                    onClick={() => onSelectZone(zone.id)}
                    routerStatus={data?.router}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          zones.indoor.map((zone) => (
            <ZoneButton
              key={zone.id}
              zone={zone}
              selected={selectedZone?.id === zone.id}
              onClick={() => onSelectZone(zone.id)}
              routerStatus={data?.router}
            />
          ))
        )}

        {zones.climate ? (
          <ZoneButton
            zone={zones.climate}
            selected={selectedZone?.id === zones.climate.id}
            onClick={() => onSelectZone(zones.climate!.id)}
          />
        ) : null}

        {zones.outside ? (
          <ZoneButton
            zone={zones.outside}
            selected={selectedZone?.id === zones.outside.id}
            onClick={() => onSelectZone(zones.outside!.id)}
            domains={["light"]}
          />
        ) : null}

        <ZoneButton
          zone={TASKS_ZONE}
          selected={tasksZoneSelected}
          onClick={() => onSelectZone(TASKS_ZONE_ID)}
          className="zone-button-tasks"
          hideCounts
        />
      </div>
    </aside>
  );
}

export function Dashboard() {
  const { theme, themeReady } = useDeviceTheme();
  useBuildReload();

  const { data, error, eventClientId, pausePolling, refresh, setData } = useDashboardState();
  const [selectedZoneId, setSelectedZoneId] = useState(selectedZoneIdFromStorage);
  const [toast, setToast] = useState<string | null>(null);
  const entityActionSequence = useRef(0);
  const zoneActionSequence = useRef(0);
  const climatePollTimers = useRef<number[]>([]);
  const lightResumePollTimer = useRef<number | null>(null);
  const attemptedAutoFullscreen = useRef(false);
  const latestData = useRef<DashboardState | null>(null);
  const airconAutoThermostatRef = useRef<AirconAutoThermostat | null>(null);
  const applyEntityActionsRef = useRef<((actions: EntityActionInput[], toastMessage: string) => Promise<void>) | null>(null);
  airconAutoThermostatRef.current ??= new AirconAutoThermostat();

  const selectedZone = useMemo(() => {
    if (!data || selectedZoneId === TASKS_ZONE_ID) {
      return null;
    }
    return data.zones.find((zone) => zone.id === selectedZoneId) ?? data.zones[0] ?? null;
  }, [data, selectedZoneId]);
  const zoneTree = useMemo(() => buildZoneTree(data), [data]);
  const loungeEnvironment = useMemo(() => findLoungeEnvironment(data), [data]);
  const bedroomTemperature = useMemo(() => findBedroomPanelHeaterTemperature(data), [data]);
  const tasksZoneSelected = selectedZoneId === TASKS_ZONE_ID;

  useEffect(() => {
    latestData.current = data;
  }, [data]);

  useEffect(() => {
    if (attemptedAutoFullscreen.current || !themeReady) {
      return;
    }

    attemptedAutoFullscreen.current = true;
    if (theme.autoFullscreenOnLoad) {
      void requestDashboardFullscreen();
    }
  }, [theme.autoFullscreenOnLoad, themeReady]);

  useEffect(() => {
    let cancelled = false;
    let preloadInterval: number | null = null;

    const runPreload = () => {
      if (!cancelled) {
        void preloadRadarTiles();
      }
    };

    runPreload();
    void import("./MapPanel");

    const now = Date.now();
    const nextRefreshDelay = Math.max(1000, RADAR_REFRESH_INTERVAL_MS - (now % RADAR_REFRESH_INTERVAL_MS) + 1000);
    const preloadTimeout = window.setTimeout(() => {
      runPreload();
      preloadInterval = window.setInterval(runPreload, RADAR_REFRESH_INTERVAL_MS);
    }, nextRefreshDelay);

    const handleAccentChange = () => runPreload();
    window.addEventListener("nova-accent-change", handleAccentChange);

    return () => {
      cancelled = true;
      window.clearTimeout(preloadTimeout);
      if (preloadInterval !== null) {
        window.clearInterval(preloadInterval);
      }
      window.removeEventListener("nova-accent-change", handleAccentChange);
    };
  }, []);

  useEffect(() => {
    if (data && selectedZoneId !== TASKS_ZONE_ID && !data.zones.some((zone) => zone.id === selectedZoneId)) {
      const fallbackZoneId = data.zones[0]?.id ?? "everything";
      setSelectedZoneId(fallbackZoneId);
      writeSelectedZoneToStorage(fallbackZoneId);
    }
  }, [data, selectedZoneId]);

  useEffect(() => {
    removeLegacySelectedZoneParam();

    const syncSelectedZoneFromStorage = () => {
      setSelectedZoneId(selectedZoneIdFromStorage());
    };

    window.addEventListener("pageshow", syncSelectedZoneFromStorage);

    return () => {
      window.removeEventListener("pageshow", syncSelectedZoneFromStorage);
    };
  }, []);

  useEffect(() => {
    writeSelectedZoneToStorage(selectedZoneId);
  }, [selectedZoneId]);

  useEffect(() => {
    return () => {
      climatePollTimers.current.forEach(window.clearTimeout);
      if (lightResumePollTimer.current !== null) {
        window.clearTimeout(lightResumePollTimer.current);
      }
    };
  }, []);

  const selectZone = useCallback((zoneId: string) => {
    setSelectedZoneId(zoneId);
    writeSelectedZoneToStorage(zoneId);
  }, []);

  const scheduleLightResumePoll = useCallback(() => {
    if (lightResumePollTimer.current !== null) {
      window.clearTimeout(lightResumePollTimer.current);
    }

    lightResumePollTimer.current = window.setTimeout(() => {
      lightResumePollTimer.current = null;
      void refresh().catch(() => undefined);
    }, LIGHT_COMMAND_POLL_HOLD_MS + 100);
  }, [refresh]);

  const scheduleClimateCommandPolls = useCallback(
    (sequence: number) => {
      climatePollTimers.current.forEach(window.clearTimeout);
      climatePollTimers.current = CLIMATE_COMMAND_POLL_DELAYS_MS.map((delay) =>
        window.setTimeout(async () => {
          try {
            const payload = await fetchDashboardStateSnapshot();
            if (sequence === entityActionSequence.current) {
              setData(payload);
            }
          } catch {
            // The regular dashboard poll will pick up the next readable state.
          }
        }, delay),
      );
    },
    [setData],
  );

  useEffect(() => {
    if (!selectedZone || !isClimateZone(selectedZone)) {
      return;
    }

    let alive = true;
    const load = () => {
      if (!alive || document.hidden) {
        return;
      }
      refresh().catch(() => undefined);
    };

    load();
    const timer = window.setInterval(load, 3000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refresh, selectedZone?.id]);

  const applyZoneAction = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      if (!selectedZone) {
        return;
      }

      const sequence = zoneActionSequence.current + 1;
      zoneActionSequence.current = sequence;
      const holdLightPolling = isLightZoneAction(action);

      if (holdLightPolling) {
        pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
        setData((current) =>
          current ? optimisticStateForZoneAction(current, selectedZone.id, action, body) : current,
        );
      }

      try {
        const response = await fetch("/api/zone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId: selectedZone.id, action, sourceClientId: eventClientId.current, ...body }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Zone action failed");
        }

        if (sequence !== zoneActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else {
          setData(payload);
        }

        setToast(`${selectedZone.name}: ${action}`);
      } catch (err) {
        if (sequence === zoneActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Zone action failed");
          if (holdLightPolling) {
            void refresh({ force: true }).catch(() => undefined);
          }
        }
      }
    },
    [eventClientId, pausePolling, refresh, scheduleLightResumePoll, selectedZone, setData],
  );

  const applyEntityActions = useCallback(
    async (actions: EntityActionInput[], toastMessage: string) => {
      if (!actions.length) {
        return;
      }

      const sequence = entityActionSequence.current + 1;
      entityActionSequence.current = sequence;
      const holdLightPolling = entityActionsAffectLightPolling(actions, data);

      pausePolling(holdLightPolling ? LIGHT_COMMAND_POLL_HOLD_MS : ENTITY_COMMAND_HOLD_MS);
      setData((current) => (current ? optimisticStateForEntityActions(current, actions) : current));

      try {
        for (const action of actions) {
          const response = await fetch("/api/entity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...action, sourceClientId: eventClientId.current }),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error ?? "Entity action failed");
          }
        }

        if (sequence !== entityActionSequence.current) {
          return;
        }

        if (holdLightPolling) {
          pausePolling(LIGHT_COMMAND_POLL_HOLD_MS);
          scheduleLightResumePoll();
        } else {
          scheduleClimateCommandPolls(sequence);
        }

        setToast(toastMessage);
      } catch (err) {
        if (sequence === entityActionSequence.current) {
          setToast(err instanceof Error ? err.message : "Entity action failed");
          void refresh({ force: true }).catch(() => undefined);
        }
      }
    },
    [data, eventClientId, pausePolling, refresh, scheduleClimateCommandPolls, scheduleLightResumePoll, setData],
  );

  useEffect(() => {
    applyEntityActionsRef.current = applyEntityActions;
  }, [applyEntityActions]);

  const airconAutoMode = data?.preferences.aircon?.autoMode ?? false;

  useEffect(() => {
    if (!airconAutoMode) {
      airconAutoThermostatRef.current?.reset();
      return;
    }

    let alive = true;
    let applying = false;

    const runAuto = async () => {
      if (!alive || applying || document.hidden) {
        return;
      }

      applying = true;
      let snapshot = latestData.current;
      try {
        snapshot = await fetchDashboardStateSnapshot();
        if (!alive) {
          return;
        }
        setData(snapshot);
      } catch {
        snapshot = latestData.current;
      }

      const currentEnvironment = findLoungeEnvironment(snapshot);
      const currentClimateZone = snapshot?.zones.find(isClimateZone) ?? null;
      const { aircon, quietSwitch, turboSwitch } = climateDevicesForZone(currentClimateZone);
      const { actions } = airconAutoThermostatRef.current!.plan({
        currentTemperature: airconAutoMeasuredTemperature(aircon, currentEnvironment),
        entity: aircon,
        preferences: snapshot?.preferences.aircon,
        quietSwitch,
        turboSwitch,
      });

      if (!actions.length) {
        applying = false;
        return;
      }

      try {
        await applyEntityActionsRef.current?.(actions, "Air Conditioner auto");
      } finally {
        applying = false;
      }
    };

    void runAuto();
    const timer = window.setInterval(runAuto, AIRCON_AUTO_POLL_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [airconAutoMode, setData]);

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="dashboard-shell min-h-screen px-4 py-5 sm:px-6">
          <header className="top-banner p-0">
            <Warnings warnings={data?.warnings} />
          </header>

          {error ? (
            <div className="border border-red-400/60 bg-red-500/10 p-6 text-lg font-black uppercase text-red-100">
              {error}
            </div>
          ) : null}

          <div className="dashboard-layout grid gap-5">
            <ClockPanel />

            <ZonesPanel
              data={data}
              selectedZone={selectedZone}
              selectedZoneId={selectedZoneId}
              zones={zoneTree}
              onSelectZone={selectZone}
            />

            <div className="control-stage grid gap-5">
              <TasksPanel showPanel={tasksZoneSelected} />

              {tasksZoneSelected ? null : selectedZone ? (
                <ZoneControls
                  zone={selectedZone}
                  bedroomTemperature={bedroomTemperature}
                  loungeEnvironment={loungeEnvironment}
                  sun={data?.sun}
                  onEntityActions={applyEntityActions}
                  onZoneAction={applyZoneAction}
                  preferences={data?.preferences}
                  router={data?.router}
                  spectrumCursor={data?.spectrumCursors?.[selectedZone.id]}
                  weather={data?.weather}
                />
              ) : (
                <div className="min-h-96 border border-neutral-700 bg-neutral-950/70 p-8 text-neutral-400">
                  Loading zone controls
                </div>
              )}
            </div>
          </div>

          <section className="dashboard-bottom-actions mt-5 border border-neutral-700 bg-neutral-950/70 p-3">
            <a className="dashboard-action-button" href="/config" aria-label="Configuration">
              <Settings className="h-6 w-6" />
            </a>
          </section>

          {toast ? (
            <div className="fixed bottom-5 right-5 max-w-sm border border-cyan-300/60 bg-neutral-950 px-4 py-3 text-sm font-black uppercase text-cyan-100 shadow-2xl">
              {toast}
            </div>
          ) : null}
        </div>
      </main>
    </Tooltip.Provider>
  );
}
