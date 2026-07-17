import type { DashboardZone } from "./types";

export type VoiceRoomOption = { id: string; name: string };

// Same room set the lighting UI treats as real, placeable rooms: HA areas,
// minus the synthetic aggregate ("Home"/everything), the climate grouping,
// the network grouping, and outside — mirrors
// app/components/dashboard/ZonesPanel.tsx's `indoor` filter so a satellite's
// room dropdown always matches the lighting sub-zones.
const EXCLUDED_ZONE_IDS = new Set(["everything", "climate", "heating", "network", "outside", "unassigned"]);

export function indoorRoomOptions(zones: DashboardZone[]): VoiceRoomOption[] {
  return zones
    .filter((zone) => {
      if (zone.special) {
        return false;
      }
      const name = zone.name.trim().toLowerCase();
      return !EXCLUDED_ZONE_IDS.has(zone.id) && !EXCLUDED_ZONE_IDS.has(name);
    })
    .map((zone) => ({ id: zone.id, name: zone.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
