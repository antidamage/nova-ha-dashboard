import type {
  ClimateAirconInstanceConfig,
  ClimateHeaterInstanceConfig,
  DashboardConfig,
} from "./config-schema";

/**
 * Which climate devices this installation has.
 *
 * The dashboard used to hard-code one air conditioner and one heater, each
 * bound to the room it happened to be in. Everything downstream — the control
 * loop, the remembered settings, the cards — now works from these lists, so a
 * home with three heaters or none is the same code path.
 *
 * This module is the ONLY place that knows how to derive instances, including
 * the fallback to the pre-instance config blocks. Keeping that in one function
 * is what stops "which aircon is Auto driving?" and "which aircon is the card
 * showing?" from ever drifting apart.
 */

export type AirconInstance = ClimateAirconInstanceConfig & { kind: "aircon" };
export type HeaterInstance = ClimateHeaterInstanceConfig & { kind: "heater" };
export type ClimateInstance = AirconInstance | HeaterInstance;

/**
 * Instance ids for a home that has not declared any, derived from the legacy
 * single-device config. These are deliberately the same keys the control state
 * and preferences have always used, so an existing installation carries its
 * remembered settings and its Nova/external ownership across unchanged — no
 * migration, and no chance of a heater resetting to defaults mid-winter.
 */
export const LEGACY_AIRCON_INSTANCE_ID = "lounge";
export const LEGACY_HEATER_INSTANCE_ID = "bedroom";

function hasAny(list: readonly string[] | undefined) {
  return Boolean(list && list.some((entry) => entry.trim().length > 0));
}

export function airconInstances(config: DashboardConfig): AirconInstance[] {
  const declared = config.dashboard.climate.airconUnits;
  if (declared.length) {
    return declared.map((unit) => ({ ...unit, kind: "aircon" }));
  }

  // Legacy shape: one unit, discovered by name rather than bound by id.
  return [
    {
      kind: "aircon",
      id: LEGACY_AIRCON_INSTANCE_ID,
      title: config.dashboard.aircon.title,
      matchTokens: config.dashboard.aircon.matchTokens,
    },
  ];
}

export function heaterInstances(config: DashboardConfig): HeaterInstance[] {
  const declared = config.dashboard.climate.heaters;
  if (declared.length) {
    return declared.map((heater) => ({ ...heater, kind: "heater" }));
  }

  const legacy = config.dashboard.bedroomHeater;
  // A home with no heater switch configured has no heater. Returning an
  // instance anyway is what used to put an empty card on every dashboard.
  if (!hasAny(legacy.switchEntityIds)) {
    return [];
  }

  return [
    {
      kind: "heater",
      id: LEGACY_HEATER_INSTANCE_ID,
      title: legacy.title,
      switchEntityIds: legacy.switchEntityIds,
      temperatureEntityIds: legacy.temperatureEntityIds,
      humidityEntityIds: legacy.humidityEntityIds,
    },
  ];
}

export function climateInstances(config: DashboardConfig): ClimateInstance[] {
  return [...airconInstances(config), ...heaterInstances(config)];
}

/**
 * The instance serving a given Home Assistant area, if any. This is what lets a
 * copy of a control appear in its own zone's panel rather than only in the
 * shared Climate zone.
 */
export function climateInstancesForZone(config: DashboardConfig, zoneId: string): ClimateInstance[] {
  const key = zoneId.trim().toLowerCase();
  return climateInstances(config).filter((instance) => instance.zoneId?.trim().toLowerCase() === key);
}
