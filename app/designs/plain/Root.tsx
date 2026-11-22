"use client";

/**
 * Plain — a second presentation layer, and the proof that the Design seam is
 * real rather than nominal.
 *
 * It renders its own shell, header and navigation markup with its own
 * stylesheet: a single column, a flat list of zones, no glow, no corner cuts,
 * system font. What it deliberately does NOT re-implement is the zone body —
 * `ZoneControls` (and `TasksPanel`) are reused verbatim, because the thermostat
 * orchestration, lighting convergence and command sequencing inside them are
 * logic, not presentation, and duplicating them here would be the exact mistake
 * this architecture exists to prevent.
 *
 * The data wiring below is intentionally identical to `Dashboard.tsx`'s: both
 * designs pull from the same hooks, which is what makes them interchangeable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { GatedLink } from "../../components/auth/GatedLink";
import { useAgentName } from "../../components/AgentNameContext";
import { ZoneControls } from "../../components/dashboard/ZoneControls";
import { TasksPanel } from "../../components/TasksPanel";
import { buildZoneTree } from "../../components/dashboard/ZonesPanel";
import { useDashboardState } from "../../components/dashboard/state";
import { useDashboardSelection } from "../../components/dashboard/useDashboardSelection";
import { useDashboardCommands } from "../../components/dashboard/useDashboardCommands";
import { useBedroomHeaterConfig } from "../../components/dashboard/useBedroomHeaterConfig";
import { bedroomHeaterDevices, findLoungeEnvironment } from "../../components/dashboard/shared";
import { useAutoFullscreen } from "../../components/dashboard/useAutoFullscreen";
import { useAutoFullscreenSetting } from "../../components/dashboard/autoFullscreenSetting";
import { useBuildReload } from "../../components/useBuildReload";
import { useDeviceTheme, type ThemeVariant } from "../../components/accentColor";
import { requestManagedDesktopWallpaperSync } from "../../components/managed-computers-client";
import { useHousePartyThemeFollow } from "../../components/dashboard/useHousePartyThemeFollow";
import { useHousePartyClockSync } from "../../components/dashboard/useHousePartyClockSync";
import { ModuleSlot } from "../../components/modules/ModuleSlot";
import { UpdateBanner } from "../../components/UpdateBanner";
import { VoiceTranscriptPanel } from "../../components/VoiceTranscriptPanel";
import type { DashboardZone } from "../../../lib/types";

import "./design.css";

/** Flattens the core zone tree into the single ordered list this design shows. */
function navZones(tree: ReturnType<typeof buildZoneTree>): DashboardZone[] {
  const ordered: (DashboardZone | null)[] = [
    tree.inside,
    ...tree.indoor,
    tree.climate,
    tree.outside,
    tree.world,
    tree.network,
    tree.power,
  ];
  return ordered.filter((zone): zone is DashboardZone => Boolean(zone));
}

export function PlainRoot() {
  const { agentName } = useAgentName();
  // Deploy watchdog and kiosk fullscreen are not decoration: without them a
  // wall panel left on this design never picks up a new build and drops out of
  // fullscreen. Every design owns these until a shared design runtime exists.
  useBuildReload();
  const [autoFullscreen] = useAutoFullscreenSetting();
  useAutoFullscreen(autoFullscreen);

  // The live theme engine. This is not decoration: `useDeviceTheme` is what
  // polls the shared theme, resolves an "auto" selection against sun state, and
  // re-applies the CSS custom properties after first paint. Without an instance
  // of it somewhere in the tree, a screen on this design keeps whatever the
  // pre-paint bootstrap set and never follows a sunset, another device's theme
  // edit, or a variant flip. `nova-classic` gets it from Dashboard.tsx (and
  // from NovaAvatar); this design places neither, so it owns it directly.
  const { activeVariant, configuredTheme, themeReady } = useDeviceTheme();
  useHousePartyThemeFollow(configuredTheme);
  useHousePartyClockSync();
  const { data, error, eventClientId, pausePolling, refresh, setData } = useDashboardState();
  const [toast, setToast] = useState<string | null>(null);
  const { selectedZone, selectedZoneId, selectZone, tasksZoneSelected } = useDashboardSelection(data);
  const zoneTree = useMemo(() => buildZoneTree(data), [data]);
  const loungeEnvironment = useMemo(() => findLoungeEnvironment(data), [data]);
  const bedroomHeaterConfig = useBedroomHeaterConfig();
  const bedroomHeater = useMemo(
    () => bedroomHeaterDevices(data, bedroomHeaterConfig),
    [data, bedroomHeaterConfig],
  );
  const {
    applyDesktopSleep,
    applyDesktopWake,
    applyEntityActions,
    applyZoneAction,
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

  // The theme hook's "auto" resolver listens for this; the dashboard route is
  // the only place it is published, so each design must publish it.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nova-sun-change", { detail: data?.sun ?? null }));
  }, [data?.sun]);

  // A dark/light flip while the dashboard is open is one of exactly two
  // triggers that push wallpapers to managed desktops (the other is leaving
  // /config). Record the first resolved variant without syncing, then push only
  // on a real flip; the sync is de-duplicated server-side.
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

  const zones = navZones(zoneTree);

  return (
    <Tooltip.Provider delayDuration={250}>
      <main className="plain-shell" data-nova-design-root="plain">
        <header className="plain-header">
          <h1 className="plain-title">{agentName}</h1>
          <GatedLink className="plain-config-link" href="/config">
            Config
          </GatedLink>
        </header>

        <UpdateBanner />

        {/* Installed modules target these slot ids; a design that omits them
            silently stops rendering every module that uses them. */}
        <ModuleSlot id="header.banner.before" />
        <ModuleSlot id="header.banner.after" />

        {error ? <p className="plain-error">{error}</p> : null}
        {data?.haHealth?.status === "degraded" ? (
          <p className="plain-notice">Reconnecting to Home Assistant…</p>
        ) : null}

        <nav className="plain-nav" aria-label="Zones">
          <ul>
            {zones.map((zone) => (
              <li key={zone.id}>
                <button
                  type="button"
                  className="plain-nav-item"
                  aria-current={zone.id === selectedZoneId ? "true" : undefined}
                  onClick={() => selectZone(zone.id)}
                >
                  {zone.name}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="plain-nav-item"
                aria-current={tasksZoneSelected ? "true" : undefined}
                onClick={() => selectZone("tasks")}
              >
                Reminders
              </button>
            </li>
          </ul>
        </nav>

        <section className="plain-body">
          <TasksPanel showPanel={tasksZoneSelected} />
          {tasksZoneSelected ? null : selectedZone ? (
            <ZoneControls
              zone={selectedZone}
              bedroomHeater={bedroomHeater}
              bedroomTemperature={bedroomHeater.temperature}
              climateControl={data?.climateControl}
              desktopSleepBusy={desktopSleepBusy}
              desktopWakeBusy={desktopWakeBusy}
              loungeEnvironment={loungeEnvironment}
              sun={data?.sun}
              onDesktopSleep={applyDesktopSleep}
              onDesktopWake={applyDesktopWake}
              onEntityActions={applyEntityActions}
              onNotice={setToast}
              onZoneAction={applyZoneAction}
              preferences={data?.preferences}
              router={data?.router}
              spectrumCursor={data?.spectrumCursors?.[selectedZone.id]}
              weather={data?.weather}
            />
          ) : (
            <p className="plain-notice">Loading zone controls</p>
          )}
        </section>

        <VoiceTranscriptPanel />

        {toast ? <p className="plain-toast">{toast}</p> : null}
      </main>
    </Tooltip.Provider>
  );
}
