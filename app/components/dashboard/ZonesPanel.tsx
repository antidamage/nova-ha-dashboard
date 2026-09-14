"use client";

import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardState } from "../../../lib/types";
import { ZoneButton } from "./ZoneButton";
import { HorizontalAccordion } from "./HorizontalAccordion";
import {
  classNames,
  isClimateZone,
  isOutsideZone,
  POWER_ZONE,
  POWER_ZONE_ID,
  TASKS_ZONE,
  TASKS_ZONE_ID,
  WORLD_ZONE,
  WORLD_ZONE_ID,
} from "./shared";

export function buildZoneTree(data: DashboardState | null) {
  const zones = data?.zones ?? [];
  const inside = zones.find((zone) => zone.id === "everything") ?? null;
  const climate = zones.find(isClimateZone) ?? null;
  const outside = zones.find(isOutsideZone) ?? null;
  const network = zones.find((zone) => zone.id === "network" || zone.name.trim().toLowerCase() === "network") ?? null;

  return {
    inside,
    climate,
    indoor: zones.filter(
      (zone) =>
        zone.id !== inside?.id &&
        zone.id !== climate?.id &&
        zone.id !== outside?.id &&
        zone.id !== network?.id,
    ),
    network,
    outside,
    world: WORLD_ZONE,
    // Null when this installation has not configured power estimation, so a
    // home with no tariff and no device ratings never sees an empty Power zone.
    power: data?.activeModuleIds?.includes("power") ? POWER_ZONE : null,
  };
}

/** True when the zone id belongs to the Home group (the Home zone and its subzones). */
export function homeGroupOwns(zones: ReturnType<typeof buildZoneTree>, zoneId: string | null | undefined) {
  return !!zoneId && (zoneId === zones.inside?.id || zones.indoor.some((zone) => zone.id === zoneId));
}

// Each group (Home, Systems) has its own selected zone, so choosing a zone in
// one never deselects or collapses the other, in both orientations
// (specs/landscape-layout.md, specs/portrait-layout.md). Each tab bar names its
// card, so the combined "Zones" heading is hidden in both (globals.css).
export function ZonesPanel({
  data,
  homeSelectedId,
  systemsSelectedId,
  zones,
  homeControls,
  systemsControls,
  onSelectZone,
}: {
  data: DashboardState | null;
  homeSelectedId: string | null;
  systemsSelectedId: string | null;
  zones: ReturnType<typeof buildZoneTree>;
  // Each group's selected-zone controls, joined to its accordion entry: to the
  // right of its list in landscape, below it in portrait.
  homeControls?: ReactNode;
  systemsControls?: ReactNode;
  onSelectZone: (zoneId: string) => void;
}) {
  const tasksZoneSelected = systemsSelectedId === TASKS_ZONE_ID;
  const powerZoneSelected = systemsSelectedId === POWER_ZONE_ID;
  const worldZoneSelected = systemsSelectedId === WORLD_ZONE_ID;

  return (
    <aside className="zones-panel border border-neutral-700 bg-neutral-950/70 p-4">
      <div className="zones-panel-heading mb-4 flex items-center justify-between">
        <h2 className="text-xl font-black uppercase text-neutral-100">Zones</h2>
        <Zap className="h-5 w-5 text-yellow-300" />
      </div>
      <div className="zone-selector-groups grid gap-3">
        <HorizontalAccordion
          title="Home"
          persistKey="dashboard-zones-home"
          group="home"
          defaultOpen
          attached={homeControls}
          attachKey={homeSelectedId}
        >
        {zones.inside ? (
          <div className={classNames("zone-tree", zones.indoor.length > 0 && "zone-parent-widget")}>
            <ZoneButton
              zone={zones.inside}
              selected={homeSelectedId === zones.inside.id}
              onClick={() => onSelectZone(zones.inside!.id)}
            />

            {zones.indoor.length ? (
              <div className="zone-children mt-3 grid gap-3">
                {zones.indoor.map((zone) => (
                  <ZoneButton
                    key={zone.id}
                    zone={zone}
                    nested
                    selected={homeSelectedId === zone.id}
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
              selected={homeSelectedId === zone.id}
              onClick={() => onSelectZone(zone.id)}
              routerStatus={data?.router}
            />
          ))
        )}

        </HorizontalAccordion>
        <HorizontalAccordion
          title="Systems"
          persistKey="dashboard-zones-systems"
          group="systems"
          defaultOpen
          attached={systemsControls}
          attachKey={systemsSelectedId}
        >
        {zones.climate ? (
          <ZoneButton
            zone={zones.climate}
            selected={systemsSelectedId === zones.climate.id}
            onClick={() => onSelectZone(zones.climate!.id)}
          />
        ) : null}

        {zones.outside ? (
          <ZoneButton
            zone={zones.outside}
            selected={systemsSelectedId === zones.outside.id}
            onClick={() => onSelectZone(zones.outside!.id)}
          />
        ) : null}

        <ZoneButton
          zone={zones.world}
          selected={worldZoneSelected}
          onClick={() => onSelectZone(WORLD_ZONE_ID)}
        />

        {zones.network ? (
          <ZoneButton
            zone={zones.network}
            selected={systemsSelectedId === zones.network.id}
            onClick={() => onSelectZone(zones.network!.id)}
            routerStatus={data?.router}
          />
        ) : null}

        {zones.power ? (
          <ZoneButton
            zone={zones.power}
            selected={powerZoneSelected}
            onClick={() => onSelectZone(POWER_ZONE_ID)}
          />
        ) : null}

        <ZoneButton
          zone={TASKS_ZONE}
          selected={tasksZoneSelected}
          onClick={() => onSelectZone(TASKS_ZONE_ID)}
          className="zone-button-tasks"
        />
        </HorizontalAccordion>
      </div>
    </aside>
  );
}
