import type { DashboardState, DashboardZone } from "../../../lib/types";
import { brightnessFromEntity, spectrumFromEntity, spectrumFromZone } from "./lighting";

export const WHOLE_HOUSE_ZONE_ID = "everything";

/** Brightness-weighted mean colour of every lit light that reports one. */
export function averageLitColor(zone: DashboardZone): [number, number, number] | null {
  let weight = 0;
  const sum = [0, 0, 0];
  for (const entity of zone.entities) {
    if (entity.domain !== "light" || entity.state !== "on") continue;
    const spectrum = spectrumFromEntity(entity);
    if (!spectrum) continue;
    const w = Math.max(1, brightnessFromEntity(entity));
    weight += w;
    for (let i = 0; i < 3; i += 1) sum[i] += spectrum.preview[i] * w;
  }
  if (!weight) return null;
  return sum.map((part) => Math.round(part / weight)) as [number, number, number];
}

/**
 * The colour to tint with, or null when nothing it follows is lit. The whole
 * house averages its lit lights; a room uses the colour its dial shows. A zone
 * that no longer exists falls back to the whole house.
 */
export function tintColor(state: DashboardState | null, zoneId: string): [number, number, number] | null {
  const zones = state?.zones ?? [];
  const room = zoneId === WHOLE_HOUSE_ZONE_ID ? null : zones.find((zone) => zone.id === zoneId) ?? null;
  if (room) {
    return room.isOn ? spectrumFromZone(room)?.preview ?? null : null;
  }
  const house = zones.find((zone) => zone.id === WHOLE_HOUSE_ZONE_ID);
  return house ? averageLitColor(house) : null;
}
