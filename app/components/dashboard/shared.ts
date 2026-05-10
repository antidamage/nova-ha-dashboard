"use client";

import {
  climateCurrentTemperature,
  climateTargetTemperature,
  isClimateEntityOn,
  numericClimateAttribute,
  stringListAttribute,
} from "../../../lib/aircon-control";
import type { DashboardEntity, DashboardState, DashboardZone, HaDomain, RouterStatus } from "../../../lib/types";

export type LoungeEnvironment = {
  humidity: number | null;
  humidityEntity?: DashboardEntity;
  temperature: number | null;
  temperatureEntity?: DashboardEntity;
};

export const STEP_EPSILON = 0.0001;
export const LOUNGE_ZONE_ID = "lounge";
export const LOUNGE_TEMPERATURE_SENSOR_IDS = [
  "sensor.tuya_mobile_lounge_sensor_temperature",
  "sensor.wifi_temperature_humidity_sensor_temperature",
  "sensor.lounge_temperature",
];
export const LOUNGE_HUMIDITY_SENSOR_IDS = [
  "sensor.tuya_mobile_lounge_sensor_humidity",
  "sensor.wifi_temperature_humidity_sensor_humidity",
  "sensor.lounge_humidity",
];
export const TASKS_ZONE_ID = "tasks";
export const TASKS_ZONE: DashboardZone = {
  id: TASKS_ZONE_ID,
  name: "Tasks",
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
    return "--.-";
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

export function dashboardEntityIsOn(entity: DashboardEntity) {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }
  if (entity.domain === "climate") {
    return entity.state !== "off";
  }
  if (entity.domain === "sensor") {
    return false;
  }
  return ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"].includes(entity.state);
}

export function zoneBrightnessPctFromEntities(entities: DashboardEntity[]) {
  const values = entities
    .filter((entity) => entity.domain === "light" && entity.state === "on")
    .map((entity) => Number(entity.attributes.brightness ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!values.length) {
    return 0;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round((average / 255) * 100);
}

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

export function isClimateZone(zone: DashboardZone) {
  const name = zone.name.trim().toLowerCase();
  return zone.id === "climate" || zone.id === "heating" || name === "climate" || name === "heating";
}

export function isNetworkZone(zone: DashboardZone) {
  return zone.id === "network" || zone.name.trim().toLowerCase() === "network";
}

export function sensorMatches(entity: DashboardEntity, target: "temperature" | "humidity") {
  if (entity.domain !== "sensor") {
    return false;
  }

  const text = entityText(entity);
  return sensorDeviceClass(entity) === target || text.includes(target);
}

export function findLoungeEnvironment(data: DashboardState | null): LoungeEnvironment | null {
  if (!data) {
    return null;
  }

  const loungeZone = data.zones.find(isLoungeZone);
  const loungeSensors = loungeZone?.entities.filter((entity) => entity.domain === "sensor") ?? [];
  const allSensors = data.entities.filter((entity) => entity.domain === "sensor");
  const temperatureEntity =
    findEntityByPreferredIds(allSensors, LOUNGE_TEMPERATURE_SENSOR_IDS) ??
    loungeSensors.find((entity) => sensorMatches(entity, "temperature")) ??
    allSensors.find((entity) => sensorMatches(entity, "temperature") && entityText(entity).includes("lounge"));
  const humidityEntity =
    findEntityByPreferredIds(allSensors, LOUNGE_HUMIDITY_SENSOR_IDS) ??
    loungeSensors.find((entity) => sensorMatches(entity, "humidity")) ??
    allSensors.find((entity) => sensorMatches(entity, "humidity") && entityText(entity).includes("lounge"));

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

export function findBedroomPanelHeaterTemperature(data: DashboardState | null) {
  const panelHeater = data?.entities.find(
    (entity) =>
      entity.domain === "climate" &&
      (entity.entity_id === "climate.panel_heater" || matchesEntity(entity, ["panel heater"])),
  );

  return panelHeater ? climateCurrentTemperature(panelHeater) : null;
}

export function countDomainsForZone(zone: DashboardZone): HaDomain[] {
  if (isNetworkZone(zone)) {
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
  const aircon =
    climateEntities.find((entity) => matchesEntity(entity, ["air conditioner", "air con", "c6780cad"])) ??
    climateEntities.find((entity) => entity.entity_id !== heater?.entity_id);
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
