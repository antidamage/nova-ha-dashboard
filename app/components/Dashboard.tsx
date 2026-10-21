"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import type { DashboardZone } from "../../lib/types";
import { useEffect, useMemo, useState } from "react";
import { useDeviceTheme } from "./accentColor";
import { ClockPanel } from "./dashboard/ClockPanel";
import { ClimateCommandsProvider } from "./dashboard/ClimateCommandsProvider";
import { SlotViewProvider, useDashboardSlotView, useSlotItems } from "./dashboard/panel-slots";
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
import { useManagedDesktopWallpaperSync } from "./dashboard/useManagedDesktopWallpaperSync";
import { useExperienceFeature } from "./dashboard/experienceModeSetting";
import { TasksPanel } from "./TasksPanel";
import { useBuildReload } from "./useBuildReload";
import { ModuleSlot } from "./modules/ModuleSlot";
import { DashboardChrome } from "./DashboardChrome";
import { NotificationStack } from "./notifications/NotificationStack";

export function Dashboard() {
  const { activeVariant, configuredTheme, theme, themeReady } = useDeviceTheme();
  useHousePartyThemeFollow(configuredTheme);
  useHousePartyClockSync();
  useBuildReload();

  useManagedDesktopWallpaperSync({ activeVariant, themeReady });

  const { data, error, eventClientId, pausePolling, refresh, setData } = useDashboardState();
  const [toast, setToast] = useState<string | null>(null);
  const { selectedZone, selectedZoneId, selectZone } = useDashboardSelection(data);
  const zoneTree = useMemo(() => buildZoneTree(data), [data]);
  const quickItems = useSlotItems("quick-access", data, zoneTree.climate).items;
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

  const groupStage = (zoneId: string | null, group: string) => {
    const zone = zoneForSelection(data, zoneId);
    return zone ? (
      <div className="control-stage" data-group={group}>
        {zoneControlsFor(zone)}
      </div>
    ) : null;
  };

  // One provider for every panel's slots; see useDashboardSlotView.
  const slotView = useDashboardSlotView({ climateZone: zoneTree.climate, commands: { onEntityActions: applyEntityActions, onNotice: setToast, onZoneAction: (zone, action, body) => applyZoneActionFor(zone, action, body) }, data, knobSkin: theme.knobSkin, sun: data?.sun, weather: data?.weather });

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        <div className="dashboard-shell dashboard-home min-h-screen px-4 py-5 sm:px-6" data-demo={process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true" ? "true" : undefined}>
          <DashboardChrome haHealth={data?.haHealth} showBackground={showBackground} theme={theme} />

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
          <SlotViewProvider view={slotView}>
          <div className="dashboard-layout grid gap-5">
            <div className="dashboard-overview">
              <ClockPanel />
              <ReminderIconBar />
            </div>

            <QuickAccessCard
              items={quickItems}
              knobSkin={theme.knobSkin}
              sun={data?.sun}
              weather={data?.weather}
              onEntityActions={applyEntityActions}
              onZoneAction={(zone, action, body) => applyZoneActionFor(zone, action, body)}
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
          </SlotViewProvider>
          </ClimateCommandsProvider>

          <NotificationStack />

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
