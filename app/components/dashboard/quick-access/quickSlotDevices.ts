"use client";

import { dashboardAirconEntity } from "../../../../lib/aircon-control";
import type { ControlPreset } from "../../../../lib/control-modules/types";
import type { DashboardEntity, DashboardState, DashboardZone } from "../../../../lib/types";
import { bedroomHeaterDevices, findConfiguredEntity, matchesEntity } from "../shared";

/**
 * Which entities a placed preset actually drives (specs/control-modules.md).
 *
 * This is the half of Quick Access that needs the live Home Assistant snapshot,
 * split out so the item model beside it stays a model. Resolution order, and why:
 * an explicit id in the preset's binding wins, then the room the preset serves,
 * and only then the zone the installation files its climate devices under — so a
 * home that has bound nothing behaves exactly as it did before presets existed.
 */

export type QuickAirconDevices = {
  entity: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  quietSwitch?: DashboardEntity;
  turboSwitch?: DashboardEntity;
};

export type QuickHeaterDevices = {
  switchEntity: DashboardEntity;
  temperature: number | null;
  humidity?: number | null;
  humidityEntity?: DashboardEntity;
};

export function zoneById(data: DashboardState | null, roomId: string | null): DashboardZone | null {
  if (!roomId) {
    return null;
  }
  return data?.zones.find((zone) => zone.id === roomId) ?? null;
}

/** The zone a preset's devices are found in: its own room, else the climate zone. */
function deviceZone(data: DashboardState | null, roomId: string | null, climateZone?: DashboardZone | null) {
  return zoneById(data, roomId) ?? climateZone ?? null;
}

export function airconDevices(
  preset: ControlPreset,
  data: DashboardState | null,
  climateZone?: DashboardZone | null,
): QuickAirconDevices | undefined {
  const zone = deviceZone(data, preset.roomId, climateZone);
  const zoneClimate = zone?.entities.filter((entity) => entity.domain === "climate") ?? [];
  // The panel heater is a climate entity too and must never be mistaken for the
  // aircon, which is why the room's own heater is excluded first (as
  // climateDevicesForZone does).
  const heater = zoneClimate.find((entity) => matchesEntity(entity, ["panel", "heater"]));
  const candidates = zoneClimate.filter((entity) => entity.entity_id !== heater?.entity_id);
  const bound = preset.binding.entityId ? findConfiguredEntity(data, [preset.binding.entityId]) : undefined;
  const entity =
    (bound?.domain === "climate" ? bound : undefined) ??
    dashboardAirconEntity(candidates, preset.binding.matchTokens ?? []);
  if (!entity) {
    return undefined;
  }
  const explicitSwitches = (preset.binding.switchEntityIds ?? [])
    .map((id) => findConfiguredEntity(data, [id]))
    .filter((switchEntity): switchEntity is DashboardEntity => Boolean(switchEntity));
  const zoneSwitches = zone?.entities.filter((candidate) => candidate.domain === "switch") ?? [];
  const pickSwitch = (words: string[]) =>
    explicitSwitches.find((switchEntity) => matchesEntity(switchEntity, words)) ??
    zoneSwitches.find((switchEntity) => matchesEntity(switchEntity, words));

  return {
    entity,
    freshAirSwitch: pickSwitch(["fresh"]),
    quietSwitch: pickSwitch(["quiet"]),
    turboSwitch: pickSwitch(["xtra", "turbo"]),
  };
}

export function heaterDevices(
  preset: ControlPreset,
  data: DashboardState | null,
  climateZone: DashboardZone | null | undefined,
  /**
   * The preset's features, ALREADY resolved against its module
   * (`resolveFeatures`). Passed in rather than read off `preset.features` here:
   * reading the raw map was a second gate, so a feature the resolver had dropped
   * as inapplicable could still be honoured by this one, and "one gate" stopped
   * being true.
   */
  features: Record<string, boolean> = {},
): QuickHeaterDevices | undefined {
  // "Grouped room sensors" is the switch that decides whether this preset reads
  // the room from its configured list at all. Off means the appliance's own
  // reading — which a bare switch does not have — so the knob shows no room
  // temperature rather than quietly reading a sensor the owner switched off.
  const grouped = features["grouped-room-sensors"] !== false;
  const devices = bedroomHeaterDevices(data, {
    humidityEntityIds: grouped ? preset.binding.humidityEntityIds : [],
    switchEntityIds: preset.binding.switchEntityIds,
    temperatureEntityIds: grouped ? preset.binding.temperatureEntityIds : [],
  });
  // No bound switch means no control: an empty knob is a permanent hole on the
  // card, and the Devices tab already says the switch list is missing.
  if (!devices.switchEntity) {
    return undefined;
  }
  return {
    humidity: devices.humidity,
    humidityEntity: devices.humidityEntity,
    switchEntity: devices.switchEntity,
    temperature: devices.temperature,
  };
}
