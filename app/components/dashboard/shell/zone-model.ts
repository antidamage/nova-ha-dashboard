"use client";

import { dashboardAirconEntity, isClimateEntityOn, stringListAttribute } from "../../../../lib/aircon-control";
import type { DashboardEntity, DashboardZone, HaDomain, RouterStatus } from "../../../../lib/types";
import { isEntityOn, zoneBrightnessPct } from "../../../../lib/entity-semantics";
import { LOUNGE_ZONE_ID, POWER_ZONE_ID, VOICE_ZONE_ID, WORLD_ZONE_ID } from "./constants";

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

export function isVoiceZone(zone: DashboardZone) {
  return zone.id === VOICE_ZONE_ID || zone.special === "voice";
}

export function sensorMatches(entity: DashboardEntity, target: "temperature" | "humidity") {
  if (entity.domain !== "sensor") {
    return false;
  }

  const text = entityText(entity);
  return sensorDeviceClass(entity) === target || text.includes(target);
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

  if (isVoiceZone(zone)) {
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
