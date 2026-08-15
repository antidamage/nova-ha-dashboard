"use client";

import {
  climateCurrentTemperature,
  climateTargetTemperature,
  dashboardAirconEntity,
  isClimateEntityOn,
  numericClimateAttribute,
  stringListAttribute,
} from "../../../lib/aircon-control";
import {
  roomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
} from "../../../lib/bedroom-heater-control";
import type { DashboardEntity, DashboardState, DashboardZone, HaDomain, RouterStatus } from "../../../lib/types";
import { isEntityOn, zoneBrightnessPct } from "../../../lib/entity-semantics";

export type LoungeEnvironment = {
  humidity: number | null;
  humidityEntity?: DashboardEntity;
  temperature: number | null;
  temperatureEntity?: DashboardEntity;
};

export const STEP_EPSILON = 0.0001;
export const LOUNGE_ZONE_ID = "lounge";
/*
 * Legacy fallback ids for the lounge's environment readout, tried only after the
 * HA-native area binding and the zone's own sensors (see findZoneEnvironment).
 *
 * The third-party Tuya puck that used to head both lists is deliberately NOT
 * here any more. It was physically moved to the bedroom on 2026-08-08 and
 * renamed, and a fallback that can still resolve it would put a bedroom reading
 * under a lounge label — a lookup by id cannot tell that the device changed
 * rooms, so the id has to go.
 *
 * sensor.lounge_temperature is the lounge's current source: a template sensor
 * exposing the Gree indoor unit's own thermistor, defined in Home Assistant's
 * template.yaml. The lounge has no standalone room sensor.
 */
/**
 * Which fallback sensors, if any, this installation has declared for a zone.
 * Empty for a zone with nothing configured, which is the normal case: the HA
 * area binding and the zone's own sensors handle almost every room.
 */
function zoneEnvironmentFallback(zone: DashboardZone, data: DashboardState | null) {
  const key = zone.name.trim().toLowerCase();
  return (data?.zoneEnvironmentFallbacks ?? []).find(
    (entry) => entry.zoneId === zone.id || entry.zoneId.trim().toLowerCase() === key,
  );
}
export const TASKS_ZONE_ID = "tasks";
export const POWER_ZONE_ID = "power";
export const WORLD_ZONE_ID = "world";
export const POWER_ZONE: DashboardZone = {
  id: POWER_ZONE_ID,
  name: "Grid",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "power",
};
export const TASKS_ZONE: DashboardZone = {
  id: TASKS_ZONE_ID,
  name: "Reminders",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "tasks",
};
export const WORLD_ZONE: DashboardZone = {
  id: WORLD_ZONE_ID,
  name: "World",
  entities: [],
  counts: {
    light: 0,
    switch: 0,
    climate: 0,
    fan: 0,
    cover: 0,
    humidifier: 0,
    sensor: 0,
  },
  isOn: false,
  brightnessPct: 0,
  special: "world",
};

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function numberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length < length) {
    return null;
  }

  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(3));
}

export function temperatureDelta(entity: DashboardEntity, delta: number, step: number, base?: number) {
  const current = base ?? climateTargetTemperature(entity) ?? 20;
  const min = numericClimateAttribute(entity, "min_temp") ?? 5;
  const max = numericClimateAttribute(entity, "max_temp") ?? 40;
  const increment = Math.abs(step) || 0.5;
  const ratio = current / increment;
  const aligned = Math.abs(ratio - Math.round(ratio)) < STEP_EPSILON;
  const stepped = aligned
    ? current + delta
    : delta > 0
      ? Math.ceil(ratio) * increment
      : Math.floor(ratio) * increment;

  return clamp(roundToStep(stepped, increment), min, max);
}

export function formatTemperature(value: number | null) {
  if (value === null) {
    return "--";
  }

  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function formatHumidity(value: number | null) {
  if (value === null) {
    return "--";
  }

  return Math.round(value).toString();
}

export function formatWeatherNumber(value: number | null, digits = 0) {
  if (value === null) {
    return "--";
  }

  return value.toFixed(digits);
}

export function weatherLabel(condition: string) {
  return condition.replaceAll("_", " ");
}

export function entityText(entity: DashboardEntity) {
  return `${entity.name} ${entity.entity_id}`.toLowerCase();
}

export function matchesEntity(entity: DashboardEntity, words: string[]) {
  const text = entityText(entity);
  return words.some((word) => text.includes(word));
}

// Single source of truth for entity on/off + brightness lives in
// lib/entity-semantics so the server projection and the client agree.
export const dashboardEntityIsOn = isEntityOn;

export const zoneBrightnessPctFromEntities = zoneBrightnessPct;

export function numericEntityState(entity?: DashboardEntity) {
  const value = Number(entity?.state);
  return Number.isFinite(value) ? value : null;
}

export function sensorDeviceClass(entity: DashboardEntity) {
  return String(entity.attributes.device_class ?? "").toLowerCase();
}

export function findEntityByPreferredIds(entities: DashboardEntity[], entityIds: string[]) {
  const byId = new Map(entities.map((entity) => [entity.entity_id, entity]));
  const preferredLive = entityIds
    .map((entityId) => byId.get(entityId))
    .find((entity) => numericEntityState(entity) !== null);

  return preferredLive ?? entityIds.map((entityId) => byId.get(entityId)).find(Boolean);
}

export function isLoungeZone(zone: DashboardZone) {
  return zone.id === LOUNGE_ZONE_ID || zone.name.trim().toLowerCase() === LOUNGE_ZONE_ID;
}

export function isBedroomZone(zone: DashboardZone) {
  return zone.id === "bedroom" || zone.name.trim().toLowerCase() === "bedroom";
}

export function isOutsideZone(zone: DashboardZone) {
  return zone.id === "outside" || zone.name.toLowerCase() === "outside";
}

export function isWorldZone(zone: DashboardZone) {
  return zone.id === WORLD_ZONE_ID || zone.special === "world";
}

export function isClimateZone(zone: DashboardZone) {
  const name = zone.name.trim().toLowerCase();
  return zone.id === "climate" || zone.id === "heating" || name === "climate" || name === "heating";
}

export function isNetworkZone(zone: DashboardZone) {
  return zone.id === "network" || zone.name.trim().toLowerCase() === "network";
}

export function isPowerZone(zone: DashboardZone) {
  return zone.id === POWER_ZONE_ID || zone.special === "power";
}

export function sensorMatches(entity: DashboardEntity, target: "temperature" | "humidity") {
  if (entity.domain !== "sensor") {
    return false;
  }

  const text = entityText(entity);
  return sensorDeviceClass(entity) === target || text.includes(target);
}

/**
 * Entity-driven environment for any zone. Priority:
 *   1. the room's HA-native area sensor binding (zone.environment)
 *   2. any temperature/humidity sensor that lives in the zone
 *   3. (lounge only) the legacy hardcoded sensor id list, kept for back-compat
 * Returns null when the zone has no environment reading at all.
 */
export function findZoneEnvironment(
  zone: DashboardZone | null | undefined,
  data: DashboardState | null,
): LoungeEnvironment | null {
  if (!zone || !data) {
    return null;
  }

  const byId = new Map(data.entities.map((entity) => [entity.entity_id, entity]));
  const zoneSensors = zone.entities.filter((entity) => entity.domain === "sensor");
  const fallback = zoneEnvironmentFallback(zone, data);
  const allSensors = fallback ? data.entities.filter((entity) => entity.domain === "sensor") : [];

  const temperatureEntity =
    (zone.environment?.temperatureEntityId ? byId.get(zone.environment.temperatureEntityId) : undefined) ??
    zoneSensors.find((entity) => sensorMatches(entity, "temperature")) ??
    (fallback ? findEntityByPreferredIds(allSensors, fallback.temperatureEntityIds) : undefined);
  const humidityEntity =
    (zone.environment?.humidityEntityId ? byId.get(zone.environment.humidityEntityId) : undefined) ??
    zoneSensors.find((entity) => sensorMatches(entity, "humidity")) ??
    (fallback ? findEntityByPreferredIds(allSensors, fallback.humidityEntityIds) : undefined);

  if (!temperatureEntity && !humidityEntity) {
    return null;
  }

  return {
    humidity: numericEntityState(humidityEntity),
    humidityEntity,
    temperature: numericEntityState(temperatureEntity),
    temperatureEntity,
  };
}

export function findLoungeEnvironment(data: DashboardState | null): LoungeEnvironment | null {
  return findZoneEnvironment(data?.zones.find(isLoungeZone) ?? null, data);
}

/**
 * Resolve one entity from a preference-ordered list of ids. The lists let a LAN
 * twin be listed ahead of its cloud twin without a code change, so this returns
 * the first id that actually exists and is reporting.
 */
export function findConfiguredEntity(data: DashboardState | null, entityIds: readonly string[]) {
  for (const entityId of entityIds) {
    const entity = data?.entities.find((candidate) => candidate.entity_id === entityId);
    if (entity && !["unavailable", "unknown"].includes(entity.state)) {
      return entity;
    }
  }
  // Fall back to a known-but-unavailable entity so the card can render its
  // unavailable state rather than disappearing entirely.
  for (const entityId of entityIds) {
    const entity = data?.entities.find((candidate) => candidate.entity_id === entityId);
    if (entity) {
      return entity;
    }
  }
  return undefined;
}

export type BedroomHeaterDevices = {
  humidity: number | null;
  humidityEntity?: DashboardEntity;
  switchEntity?: DashboardEntity;
  temperature: number | null;
  temperatureEntity?: DashboardEntity;
};

export function bedroomHeaterDevices(
  data: DashboardState | null,
  config?: {
    switchEntityIds?: readonly string[];
    temperatureEntityIds?: readonly string[];
    humidityEntityIds?: readonly string[];
  } | null,
): BedroomHeaterDevices {
  const configuredTemperatureEntity = findConfiguredEntity(
    data,
    roomTemperatureEntityIds(config?.temperatureEntityIds ?? []),
  );
  const temperatureEntity = bedroomTemperatureStateIsFresh(configuredTemperatureEntity)
    ? configuredTemperatureEntity
    : undefined;
  const humidityEntity = findConfiguredEntity(data, config?.humidityEntityIds ?? []);

  return {
    humidity: numericEntityState(humidityEntity),
    humidityEntity,
    switchEntity: findConfiguredEntity(data, config?.switchEntityIds ?? []),
    temperature: numericEntityState(temperatureEntity),
    temperatureEntity,
  };
}

/**
 * Bedroom temperature for the environment panels, resolved from the same
 * configured priority list the thermostat loop uses so the number on screen is
 * the number the heater is deciding on.
 *
 * That list leads with a standalone room puck. It used to read the bedroom
 * heater's own onboard sensor, which turned out to be far too damped to be a
 * room reading at all — see dashboard.bedroomHeater.temperatureEntityIds in
 * lib/config-schema.ts.
 */
export function findBedroomTemperature(
  data: DashboardState | null,
  config?: { temperatureEntityIds?: readonly string[] } | null,
) {
  const entity = findConfiguredEntity(data, roomTemperatureEntityIds(config?.temperatureEntityIds ?? []));
  return bedroomTemperatureStateIsFresh(entity) ? numericEntityState(entity) : null;
}

export function countDomainsForZone(zone: DashboardZone): HaDomain[] {
  if (isPowerZone(zone)) {
    return [];
  }

  if (isNetworkZone(zone)) {
    return [];
  }

  if (isWorldZone(zone)) {
    return [];
  }

  if (isOutsideZone(zone)) {
    return ["light"];
  }

  if (isClimateZone(zone)) {
    return ["climate"];
  }

  return ["light", "switch"];
}

export function climateDevicesForZone(zone?: DashboardZone | null) {
  const climateEntities = zone?.entities.filter((entity) => entity.domain === "climate") ?? [];
  const heater =
    climateEntities.find((entity) => matchesEntity(entity, ["panel", "heater"])) ??
    climateEntities.find((entity) => entity.entity_id.includes("panel_heater"));
  const aircon = dashboardAirconEntity(climateEntities.filter((entity) => entity.entity_id !== heater?.entity_id));
  const switches = zone?.entities.filter((entity) => entity.domain === "switch") ?? [];

  return {
    aircon,
    freshAirSwitch: switches.find((entity) => matchesEntity(entity, ["fresh"])),
    heater,
    quietSwitch: switches.find((entity) => matchesEntity(entity, ["quiet"])),
    turboSwitch: switches.find((entity) => matchesEntity(entity, ["xtra", "turbo"])),
  };
}

export function optimisticClimateOnState(entity: DashboardEntity) {
  if (isClimateEntityOn(entity)) {
    return entity.state;
  }

  return stringListAttribute(entity, "hvac_modes").find((mode) => !["off", "unavailable", "unknown"].includes(mode)) ?? "heat";
}

export function routerStatusLabel(router?: RouterStatus) {
  return router?.wanConnected ? "Connected" : "Disconnected";
}
