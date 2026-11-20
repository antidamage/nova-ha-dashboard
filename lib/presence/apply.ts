import { applyClimateControlIntent } from "../climate-control";
import { heaterInstances } from "../climate-instances";
import type { DashboardConfig } from "../config-schema";
import { buildDashboardState } from "../ha";
import { setAllLightingAction, setZoneLightingAction } from "../ha/lighting/zone-lighting-actions";
import { lightLayerEntities } from "../ha/zones";
import { isOutsideZone } from "../home-users/model";
import type { DashboardZone } from "../types";
import type { PresenceAction } from "./rules-model";

/**
 * Carries out the occupancy rules' actions (specs/home-users.md section 5).
 *
 * Lights go through the light-layer actions only, never the zone `off` lighting
 * command, because that one also switches off climate entities and the air
 * conditioning must not react to anyone coming or going. A heater is only ever
 * written `mode: "off"`.
 *
 * Every action is attempted; one failure is reported and does not stop the rest.
 */

export type PresenceActionResult = PresenceAction & { ok: boolean; error?: string };

/** A zone's heaters: bound by `zoneId`, or, with none, keyed by the room's id. */
export function heatersForZone(config: DashboardConfig, zoneId: string) {
  return heaterInstances(config).filter((heater) => (heater.zoneId ? heater.zoneId === zoneId : heater.id === zoneId));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function eachZone(zoneIds: string[], run: (zone: DashboardZone) => Promise<unknown>) {
  const dashboard = await buildDashboardState();
  const errors: string[] = [];
  for (const zoneId of zoneIds) {
    const zone = dashboard.zones.find((candidate) => candidate.id === zoneId);
    // A room with no lights has nothing to switch; that is not a failure.
    if (!zone || !lightLayerEntities(zone.entities).length) continue;
    try {
      await run(zone);
    } catch (error) {
      errors.push(`${zoneId}: ${message(error)}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
}

async function applyOne(action: PresenceAction, config: DashboardConfig) {
  switch (action.kind) {
    case "lights-off-house":
      await setAllLightingAction({ action: "off" });
      return;
    case "lights-off":
      await eachZone(action.zones, (zone) => setZoneLightingAction({ zoneId: zone.id, action: "off" }));
      return;
    case "lights-on":
      await eachZone(action.zones, (zone) =>
        setZoneLightingAction({ zoneId: zone.id, action: "on", mode: isOutsideZone(zone) ? "power" : "adaptive" }),
      );
      return;
    case "heater-off":
      for (const zoneId of action.zones) {
        for (const heater of heatersForZone(config, zoneId)) {
          await applyClimateControlIntent({ room: heater.id, mode: "off" });
        }
      }
      return;
  }
}

export async function applyPresenceActions(
  actions: PresenceAction[],
  config: DashboardConfig,
): Promise<PresenceActionResult[]> {
  const results: PresenceActionResult[] = [];
  for (const action of actions) {
    try {
      await applyOne(action, config);
      results.push({ ...action, ok: true });
    } catch (error) {
      results.push({ ...action, ok: false, error: message(error) });
    }
  }
  return results;
}
