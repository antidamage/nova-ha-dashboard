"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceTheme, type ThemeVariant } from "./accentColor";
import { requestManagedDesktopWallpaperSync } from "./managed-computers-client";
import { ClockPanel } from "./dashboard/ClockPanel";
import { ZoneControls } from "./dashboard/ZoneControls";
import {
  findBedroomPanelHeaterTemperature,
  findLoungeEnvironment,
} from "./dashboard/shared";
import { useDashboardState } from "./dashboard/state";
import { Warnings } from "./dashboard/Warnings";
import { buildZoneTree, ZonesPanel } from "./dashboard/ZonesPanel";
import { useAirconAutoMode } from "./dashboard/useAirconAutoMode";
import { useAutoFullscreen } from "./dashboard/useAutoFullscreen";
import { useAutoFullscreenSetting } from "./dashboard/autoFullscreenSetting";
import { useDashboardCommands } from "./dashboard/useDashboardCommands";
import { useDashboardSelection } from "./dashboard/useDashboardSelection";
import { useRadarPreload } from "./dashboard/useRadarPreload";
import { useScrollRestore } from "./dashboard/useScrollRestore";
import { FluidBackground } from "./FluidBackground";
import { useExperienceFeature } from "./dashboard/experienceModeSetting";
import { TasksPanel } from "./TasksPanel";
import { UpdateBanner } from "./UpdateBanner";
import { ReloadButton } from "./ReloadButton";
import { useBuildReload } from "./useBuildReload";
import { VoiceTranscriptPanel } from "./VoiceTranscriptPanel";

export function Dashboard() {
  const { activeVariant, theme, themeReady } = useDeviceTheme();
  useBuildReload();

  // The dashboard is the only place a dark/light flip should push wallpapers to
  // managed desktops (config edits wait for "Back"). This effect lives in the
  // dashboard component, so it never runs on the config screen. We record the
  // first resolved variant without syncing, then push only on an actual flip.
  // The sync is deduplicated server-side, so the same image is never re-sent.
  const lastSyncedVariantRef = useRef<ThemeVariant | null>(null);
  useEffect(() => {
    if (!themeReady) {
      return;
    }
    const previous = lastSyncedVariantRef.current;
    lastSyncedVariantRef.current = activeVariant;
    if (previous === null || previous === activeVariant) {
      return;
    }
    void requestManagedDesktopWallpaperSync().catch((error) => {
      console.error("[nova-dashboard] managed desktop wallpaper sync failed", error);
    });
  }, [activeVariant, themeReady]);

  const { data, error, eventClientId, isPollingPaused, pausePolling, refresh, setData } = useDashboardState();
  const [toast, setToast] = useState<string | null>(null);
  const { selectedZone, selectedZoneId, selectZone, tasksZoneSelected } = useDashboardSelection(data);
  const zoneTree = useMemo(() => buildZoneTree(data), [data]);
  const loungeEnvironment = useMemo(() => findLoungeEnvironment(data), [data]);
  const bedroomTemperature = useMemo(() => findBedroomPanelHeaterTemperature(data), [data]);
  const [autoFullscreen] = useAutoFullscreenSetting();
  useAutoFullscreen(autoFullscreen);
  const showBackground = useExperienceFeature("background");
  useRadarPreload();
  useScrollRestore(data !== null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nova-sun-change", { detail: data?.sun ?? null }));
  }, [data?.sun]);
  const { applyDesktopSleep, applyDesktopWake, applyEntityActions, applyZoneAction, desktopSleepBusy, desktopWakeBusy } = useDashboardCommands({
    data,
    eventClientId,
    pausePolling,
    refresh,
    selectedZone,
    setData,
    setToast,
  });
  useAirconAutoMode({ applyEntityActions, data, isPollingPaused, setData });

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="dashboard-shell min-h-screen px-4 py-5 sm:px-6">
          {/* Devices with the background feature off skip the WebGL background
              entirely; the shell's own static themed grid background remains. */}
          {showBackground ? <FluidBackground theme={theme} /> : null}
          <ReloadButton />
          <Link
            className="dashboard-config-link"
            href="/config"
            aria-label="Configuration"
            data-demo-tooltip-title="Config"
            data-demo-tooltip="Open dashboard theme and setup tools."
          >
            <Settings className="h-5 w-5" />
            Config
          </Link>

          <UpdateBanner />

          {data?.haHealth?.status === "degraded" ? (
            // Home Assistant returned a mass-unavailable snapshot (restart/reload).
            // The server is holding last-known-good state (lib/ha/health.ts), so
            // tiles keep their values dimmed rather than all flipping to dead —
            // this chip is the only outward sign of the blip.
            <div
              className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 border border-amber-300/60 bg-neutral-950/90 px-4 py-2 text-xs font-black uppercase tracking-wide text-amber-200 shadow-2xl"
              role="status"
              aria-live="polite"
            >
              Reconnecting to Home Assistant…
            </div>
          ) : null}

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
                  desktopSleepBusy={desktopSleepBusy}
                  desktopWakeBusy={desktopWakeBusy}
                  loungeEnvironment={loungeEnvironment}
                  sun={data?.sun}
                  onDesktopSleep={applyDesktopSleep}
                  onDesktopWake={applyDesktopWake}
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

          <VoiceTranscriptPanel />

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
