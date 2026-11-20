import { adaptiveLightBrightnessPctForEntity, adaptiveLightMode, isPinnedLightEntity } from "../lighting-presets";
import { isOutsideZone } from "../home-users/model";
import { buildDashboardState } from "../state";
import type { DashboardEntity } from "../types";
import { callLightingService, callMany } from "../ha/lighting/commands";
import { adaptiveCandlelightBrightnessPct, supportsBrightness } from "../ha/lighting/light-model";

/**
 * Re-check the night cap after someone arrives or leaves (specs/home-users.md
 * section 6). Every light that is on, at night, in a zone following adaptive
 * lighting is re-sent its adaptive brightness when it is more than 2 points
 * away. That dims the kitchen when a lower-cap person comes home, and brings it
 * back up when they leave.
 *
 * Only brightness is sent: colour stays as the zone left it. A light outside
 * every adaptive zone holds a value someone chose, and is left alone.
 */

const TOLERANCE_PCT = 2;

function brightnessPctOf(entity: DashboardEntity) {
  const raw = Number(entity.attributes.brightness);
  return Number.isFinite(raw) ? Math.round((raw / 255) * 100) : null;
}

export async function reapplyNightCaps(extraAdaptiveZoneIds: readonly string[] = []) {
  const dashboard = await buildDashboardState();
  const mode = adaptiveLightMode(dashboard.sun);
  if (mode !== "candlelight") return 0;

  const remembered = dashboard.preferences.lighting?.adaptiveCandlelightZones ?? {};
  const adaptive = new Set([
    ...Object.entries(remembered).filter(([, preference]) => preference.enabled).map(([zoneId]) => zoneId),
    ...extraAdaptiveZoneIds,
  ]);
  const fallback = adaptiveCandlelightBrightnessPct(dashboard.sun);
  const seen = new Set<string>();
  const sends: Promise<unknown>[] = [];

  for (const zone of [...dashboard.zones, ...(dashboard.memberZones ?? [])]) {
    if (!adaptive.has(zone.id) || isOutsideZone(zone)) continue;
    for (const entity of zone.entities) {
      if (entity.domain !== "light" || entity.state !== "on" || seen.has(entity.entity_id)) continue;
      seen.add(entity.entity_id);
      if (!supportsBrightness(entity) || isPinnedLightEntity(entity, dashboard.lighting)) continue;
      const current = brightnessPctOf(entity);
      const target = adaptiveLightBrightnessPctForEntity(entity, dashboard.lighting, mode, fallback);
      if (current !== null && Math.abs(current - target) <= TOLERANCE_PCT) continue;
      sends.push(callLightingService("light", "turn_on", { entity_id: entity.entity_id, brightness_pct: target }));
    }
  }
  await callMany(sends);
  return sends.length;
}
