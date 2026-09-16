"use client";

import {
  roomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
} from "../../../../lib/bedroom-heater-control";
import type { DashboardState, DashboardZone } from "../../../../lib/types";
import type { BedroomHeaterDevices, LoungeEnvironment } from "./types";
import { findEntityByPreferredIds, isLoungeZone, numericEntityState, sensorMatches } from "./zone-model";

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
