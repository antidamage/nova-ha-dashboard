"use client";

import { Zap } from "lucide-react";
import type { DashboardState, DashboardZone } from "../../../lib/types";
import { ZoneButton } from "./ZoneButton";
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

export function ZonesPanel({
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
  const powerZoneSelected = selectedZoneId === POWER_ZONE_ID;
  const worldZoneSelected = selectedZoneId === WORLD_ZONE_ID;

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
          zone={zones.world}
          selected={worldZoneSelected}
          onClick={() => onSelectZone(WORLD_ZONE_ID)}
          hideCounts
        />

        {zones.network ? (
          <ZoneButton
            zone={zones.network}
            selected={selectedZone?.id === zones.network.id}
            onClick={() => onSelectZone(zones.network!.id)}
            routerStatus={data?.router}
          />
        ) : null}

        {zones.power ? (
          <ZoneButton
            zone={zones.power}
            selected={powerZoneSelected}
            onClick={() => onSelectZone(POWER_ZONE_ID)}
            hideCounts
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
