"use client";

import type { ReactNode } from "react";
import type {
  DashboardPreferences,
  ClimateControlState,
  DashboardZone,
  RouterStatus,
  WeatherStatus,
} from "../../../lib/types";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import type { EntityActionInput } from "../../../lib/aircon-control";
import {
  isClimateZone,
  isNetworkZone,
  isOutsideZone,
  isPowerZone,
  isWorldZone,
  type BedroomHeaterDevices,
  type LoungeEnvironment,
} from "./shared";
import { PowerPanel } from "./PowerPanel";
import { RouterPanel } from "./RouterPanel";
import { ClimateControls } from "./ClimateControls";
import { OutsideControls } from "./OutsideControls";
import { useExperienceFeature } from "./experienceModeSetting";

const MapPanel = dynamic(() => import("../MapPanel").then((module) => module.MapPanel), { ssr: false });

// Devices with the world-map feature off never mount maplibre (WebGL map,
// satellite tiles, radar animation) â€” they get a static placeholder instead,
// and the dynamic import above never loads.
function WorldMapPanel() {
  const showWorldMap = useExperienceFeature("worldMap");

  if (!showWorldMap) {
    return (
      <section className="world-map-panel world-map-panel-lite border border-[var(--cyber-line-dim)] bg-[var(--cyber-panel)]">
        <p className="world-map-panel-lite-title">Map Offline</p>
        <p className="world-map-panel-lite-detail">
          The live map is off on this device. Enable â€œShow World Mapâ€ in Config â†’ This Device to
          restore it.
        </p>
      </section>
    );
  }

  return (
    <section className="world-map-panel border border-[var(--cyber-line-dim)] bg-[var(--cyber-panel)]">
      <Suspense fallback={null}>
        <MapPanel className="h-full w-full" />
      </Suspense>
    </section>
  );
}

/**
 * Everything a zone panel might need. A primary panel takes over the whole zone
 * body (replacing the lighting controls); zones with no primary panel fall back
 * to the lighting controls plus any additive panels.
 */
export type PrimaryPanelContext = {
  zone: DashboardZone;
  desktopSleepBusy?: boolean;
  desktopWakeBusy?: boolean;
  router?: RouterStatus;
  weather?: WeatherStatus | null;
  preferences?: DashboardPreferences;
  loungeEnvironment?: LoungeEnvironment | null;
  bedroomHeater?: BedroomHeaterDevices;
  climateControl?: ClimateControlState;
  onDesktopSleep?: (computer: { id: string; name: string }) => void;
  onDesktopWake?: (computer: { id: string; name: string }) => void;
  onEntityActions: (actions: EntityActionInput[], toast: string) => Promise<void>;
};

export type PrimaryZonePanel = {
  id: string;
  appliesTo: (zone: DashboardZone) => boolean;
  render: (context: PrimaryPanelContext) => ReactNode;
};

/**
 * Registry of full-body zone panels. Adding a new whole-zone panel is a single
 * entry here instead of another branch in the ZoneControls dispatch. Order is
 * precedence (first match wins).
 */
export const primaryZonePanels: PrimaryZonePanel[] = [
  {
    id: "power",
    appliesTo: isPowerZone,
    render: () => <PowerPanel />,
  },
  {
    id: "network",
    appliesTo: isNetworkZone,
    render: ({ desktopSleepBusy, desktopWakeBusy, onDesktopSleep, onDesktopWake, router }) => (
      router ? (
        <RouterPanel
          router={router}
          desktopSleepBusy={desktopSleepBusy}
          desktopWakeBusy={desktopWakeBusy}
          onDesktopSleep={onDesktopSleep}
          onDesktopWake={onDesktopWake}
        />
      ) : null
    ),
  },
  {
    id: "climate",
    appliesTo: isClimateZone,
    render: ({ zone, bedroomHeater, climateControl, preferences, onEntityActions }) => (
      <ClimateControls
        zone={zone}
        bedroomHeater={bedroomHeater}
        climateControl={climateControl}
        preferences={preferences}
        onEntityActions={onEntityActions}
      />
    ),
  },
  {
    id: "outside",
    appliesTo: isOutsideZone,
    render: ({ zone, weather, onEntityActions }) => (
      <OutsideControls zone={zone} weather={weather ?? null} onEntityActions={onEntityActions} />
    ),
  },
  {
    id: "world",
    appliesTo: isWorldZone,
    render: () => <WorldMapPanel />,
  },
];

export function selectPrimaryZonePanel(zone: DashboardZone): PrimaryZonePanel | undefined {
  return primaryZonePanels.find((panel) => panel.appliesTo(zone));
}
