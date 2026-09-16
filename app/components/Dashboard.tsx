"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Settings } from "lucide-react";
import { GatedLink } from "./auth/GatedLink";
import type { DashboardZone } from "../../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceTheme, type ThemeVariant } from "./accentColor";
import { requestManagedDesktopWallpaperSync } from "./managed-computers-client";
import { ClockPanel } from "./dashboard/ClockPanel";
import { ClimateCommandsProvider } from "./dashboard/ClimateCommandsProvider";
import { QuickAccessCard } from "./dashboard/QuickAccessCard";
import { ReminderIconBar } from "./dashboard/ReminderIconBar";
import { ZoneControls } from "./dashboard/ZoneControls";
import {
  bedroomHeaterDevices,
  climateDevicesForZone,
  findLoungeEnvironment,
  TASKS_ZONE_ID,
} from "./dashboard/shared";
import { useBedroomHeaterConfig } from "./dashboard/useBedroomHeaterConfig";
import { useDashboardState } from "./dashboard/state";
import { Warnings } from "./dashboard/Warnings";
import { buildZoneTree, ZonesPanel } from "./dashboard/ZonesPanel";
import { useAutoFullscreen } from "./dashboard/useAutoFullscreen";
import { useAutoFullscreenSetting } from "./dashboard/autoFullscreenSetting";
import { useDashboardCommands } from "./dashboard/useDashboardCommands";
import { useHousePartyThemeFollow } from "./dashboard/useHousePartyThemeFollow";
import { useHousePartyClockSync } from "./dashboard/useHousePartyClockSync";
import { useDashboardSelection, zoneForSelection } from "./dashboard/useDashboardSelection";
import { useGroupSelection } from "./dashboard/useGroupSelection";
import { useRadarPreload } from "./dashboard/useRadarPreload";
import { useScrollAnchor } from "./dashboard/useScrollAnchor";
import { useScrollRestore } from "./dashboard/useScrollRestore";
import { FluidBackground } from "./FluidBackground";
import { WallpaperBackground } from "./WallpaperBackground";
import { useExperienceFeature } from "./dashboard/experienceModeSetting";
import { TasksPanel } from "./TasksPanel";
import { UpdateBanner } from "./UpdateBanner";
import { ReloadButton } from "./ReloadButton";
import { ThemeOverrideButton } from "./ThemeOverrideButton";
import { HeaderFadeStrip } from "./dashboard/HeaderFadeStrip";
import { useBuildReload } from "./useBuildReload";
import { ModuleSlot } from "./modules/ModuleSlot";

export function Dashboard() {
  const { activeVariant, configuredTheme, theme, themeReady } = useDeviceTheme();
  useHousePartyThemeFollow(configuredTheme);
  useHousePartyClockSync();
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

  const { data, error, eventClientId, pausePolling, refresh, setData } = useDashboardState();
  const [toast, setToast] = useState<string | null>(null);
  const { selectedZone, selectedZoneId, selectZone } = useDashboardSelection(data);
  const zoneTree = useMemo(() => buildZoneTree(data), [data]);
  const loungeEnvironment = useMemo(() => findLoungeEnvironment(data), [data]);
  const bedroomHeaterConfig = useBedroomHeaterConfig();
  const bedroomHeater = useMemo(
    () => bedroomHeaterDevices(data, bedroomHeaterConfig),
    [data, bedroomHeaterConfig],
  );
  const bedroomTemperature = bedroomHeater.temperature;
  // One climate command instance per room, shared by the Quick Access segments
  // and the full climate cards below (see ClimateCommandsProvider).
  const climateDevices = useMemo(() => climateDevicesForZone(zoneTree.climate), [zoneTree.climate]);
  const [autoFullscreen] = useAutoFullscreenSetting();
  useAutoFullscreen(autoFullscreen);
  const showBackground = useExperienceFeature("background");
  useRadarPreload();
  useScrollRestore(data !== null);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nova-sun-change", { detail: data?.sun ?? null }));
  }, [data?.sun]);
  const {
    applyDesktopSleep,
    applyDesktopWake,
    applyEntityActions,
    applyZoneActionFor,
    desktopSleepBusy,
    desktopWakeBusy,
  } = useDashboardCommands({
    data,
    eventClientId,
    pausePolling,
    refresh,
    selectedZone,
    setData,
    setToast,
  });

  const { homeId, systemsId } = useGroupSelection(zoneTree, selectedZoneId, data !== null);
  // Selecting a zone remounts its control stage at a different size; hold the
  // page still across that (specs/landscape-layout.md).
  useScrollAnchor(`${homeId ?? ""}|${systemsId ?? ""}`);

  const zoneControlsFor = (zone: DashboardZone) => (
    <ZoneControls
      key={zone.id}
      zone={zone}
      bedroomHeater={bedroomHeater}
      bedroomTemperature={bedroomTemperature}
      climateControl={data?.climateControl}
      desktopSleepBusy={desktopSleepBusy}
      desktopWakeBusy={desktopWakeBusy}
      knobSkin={theme.knobSkin}
      loungeEnvironment={loungeEnvironment}
      sun={data?.sun}
      onDesktopSleep={applyDesktopSleep}
      onDesktopWake={applyDesktopWake}
      onEntityActions={applyEntityActions}
      onNotice={setToast}
      onZoneAction={(action, body) => applyZoneActionFor(zone, action, body)}
      preferences={data?.preferences}
      router={data?.router}
      spectrumCursor={data?.spectrumCursors?.[zone.id]}
      weather={data?.weather}
    />
  );

  // Each accordion group has its own selected zone and joins its controls to
  // its entry, in both orientations (specs/landscape-layout.md,
  // specs/portrait-layout.md).
  const groupStage = (zoneId: string | null, group: string) => {
    const zone = zoneForSelection(data, zoneId);
    return zone ? (
      <div className="control-stage" data-group={group}>{zoneControlsFor(zone)}</div>
    ) : null;
  };

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="dashboard-shell dashboard-home min-h-screen px-4 py-5 sm:px-6" data-demo={process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true" ? "true" : undefined}>
          {/* Devices with the background feature off skip the WebGL background
              entirely; the shell's own static themed grid background remains. */}
          {showBackground ? (
            theme.desktopWallpaper.useAsDashboardBackground ? (
              <WallpaperBackground wallpaper={theme.desktopWallpaper} />
            ) : (
              <FluidBackground theme={theme} />
            )
          ) : null}
          <HeaderFadeStrip />
          <ReloadButton />
          <ThemeOverrideButton />
          <GatedLink
            className="dashboard-config-link"
            href="/config"
            aria-label="Configuration"
            data-demo-tooltip-title="Config"
            data-demo-tooltip="Open dashboard theme and setup tools."
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </GatedLink>

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
            <ModuleSlot id="header.banner.before" />
            <Warnings warnings={data?.warnings} />
            <ModuleSlot id="header.banner.after" />
          </header>

          {error ? (
            <div className="border border-red-400/60 bg-red-500/10 p-6 text-lg font-black uppercase text-red-100">
              {error}
            </div>
          ) : null}

          <ClimateCommandsProvider
            aircon={{
              controlState: data?.climateControl?.lounge,
              entity: climateDevices.aircon,
              preferences: data?.preferences?.aircon,
              quietSwitch: climateDevices.quietSwitch,
              turboSwitch: climateDevices.turboSwitch,
              onEntityActions: applyEntityActions,
            }}
            heater={{ onNotice: setToast, preferences: data?.preferences?.bedroomHeater }}
          >
          <div className="dashboard-layout grid gap-5">
            <div className="dashboard-overview">
              <ClockPanel />
              <ReminderIconBar />
            </div>

            <QuickAccessCard
              bedroomHeater={bedroomHeater}
              climateControl={data?.climateControl}
              climateZone={zoneTree.climate}
              homeZone={zoneTree.inside}
              knobSkin={theme.knobSkin}
              preferences={data?.preferences}
              spectrumCursor={zoneTree.inside ? data?.spectrumCursors?.[zoneTree.inside.id] : undefined}
              sun={data?.sun}
              weather={data?.weather}
              onEntityActions={applyEntityActions}
              onHomeZoneAction={(action, body) =>
                zoneTree.inside ? applyZoneActionFor(zoneTree.inside, action, body) : Promise.resolve()
              }
              onNotice={setToast}
            />

            <ZonesPanel
              data={data}
              homeSelectedId={homeId}
              systemsSelectedId={systemsId}
              zones={zoneTree}
              homeControls={groupStage(homeId, "home")}
              systemsControls={groupStage(systemsId, "systems")}
              /* Selecting a zone never scrolls the page, in either
                 orientation (specs/portrait-layout.md round 2). */
              onSelectZone={(zoneId) => selectZone(zoneId)}
            />

            {/* Kept mounted in one place in both orientations so reminders keep
                running; shown as the Systems entry's joined panel when Tasks is
                its selection: to the right in landscape, below in portrait. */}
            <div className="control-stage tasks-stage" data-group="systems" hidden={systemsId !== TASKS_ZONE_ID}>
              <TasksPanel showPanel={systemsId === TASKS_ZONE_ID} />
            </div>
          </div>
          </ClimateCommandsProvider>

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
