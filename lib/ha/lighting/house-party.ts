// House Party teardown: snapshot the colour lights it may animate so they can
// be restored. The per-frame renderer and its caches live in ./store.
import { callService } from "../client";
import { buildDashboardState } from "../../state";
import { numericAttribute, supportsColor } from "./light-model";
import type { HousePartyLightSnapshot } from "./types";

function finiteNumberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length !== length) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

/**
 * Captures only the colour-capable, currently-on lights that House Party is
 * allowed to animate. On/off-only lights are deliberately absent, so neither
 * the party nor its teardown touches devices such as the lounge neons.
 */
export async function captureHousePartyLightingRestore() {
  const dashboard = await buildDashboardState();
  const enabledZones = dashboard.preferences.lighting?.housePartyZones ?? {};
  const snapshots = new Map<string, HousePartyLightSnapshot>();

  for (const zone of dashboard.zones) {
    if (!enabledZones[zone.id]?.enabled) continue;
    for (const entity of zone.entities) {
      if (
        entity.domain !== "light"
        || entity.state !== "on"
        || !supportsColor(entity)
        || snapshots.has(entity.entity_id)
      ) continue;

      const serviceData: Record<string, unknown> = { entity_id: entity.entity_id };
      const brightness = numericAttribute(entity, "brightness");
      if (brightness !== null) serviceData.brightness = Math.max(1, Math.min(255, Math.round(brightness)));

      const colorMode = String(entity.attributes.color_mode ?? "");
      const colorAttribute = colorMode === "color_temp"
        ? (numericAttribute(entity, "color_temp_kelvin") !== null ? "color_temp_kelvin" : "color_temp")
        : colorMode === "hs" ? "hs_color"
        : colorMode === "xy" ? "xy_color"
        : colorMode === "rgbw" ? "rgbw_color"
        : colorMode === "rgbww" ? "rgbww_color"
        : "rgb_color";
      const colorLength = colorAttribute === "hs_color" || colorAttribute === "xy_color" ? 2
        : colorAttribute === "rgbw_color" ? 4
        : colorAttribute === "rgbww_color" ? 5
        : colorAttribute === "rgb_color" ? 3
        : 0;
      if (colorLength) {
        const color = finiteNumberArray(entity.attributes[colorAttribute], colorLength);
        if (color) serviceData[colorAttribute] = color;
      } else {
        const temperature = numericAttribute(entity, colorAttribute);
        if (temperature !== null) serviceData[colorAttribute] = Math.round(temperature);
      }
      snapshots.set(entity.entity_id, { entityId: entity.entity_id, serviceData });
    }
  }

  return async () => {
    await Promise.all(
      [...snapshots.values()].map(({ entityId, serviceData }) =>
        callService("light", "turn_on", serviceData, {
          latestKey: `lighting:${entityId}`,
        })),
    );
  };
}
