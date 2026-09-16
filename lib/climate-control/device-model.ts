import { dashboardAirconEntity } from "../aircon-control";
import { roomTemperatureEntityIds } from "../bedroom-heater-control";
import { airconDrySupport } from "../aircon-dry";
import type { AirconInstance, ClimateInstance, HeaterInstance } from "../climate-instances";
import type { DashboardEntity, HaDomain, HaState } from "../types";
import { AIRCON_START_WINDOW_MS } from "./constants";
import type { PersistedRoom } from "./types";

export function rawAsDashboardEntity(state: HaState): DashboardEntity {
  const domain = state.entity_id.split(".", 1)[0] as HaDomain;
  return {
    ...state,
    domain,
    name: String(state.attributes.friendly_name ?? state.entity_id),
    area_id: "climate",
  };
}

export function stateReportTime(state?: HaState) {
  const sourceReportedAt = state?.attributes.source_reported_at;
  return typeof sourceReportedAt === "string" && sourceReportedAt
    ? sourceReportedAt
    : state?.last_reported ?? state?.last_updated ?? state?.last_changed ?? null;
}

export function usable(state?: HaState) {
  return Boolean(state && !["unknown", "unavailable"].includes(state.state));
}

export function findNamedSwitch(states: HaState[], tokens: string[]) {
  return states.find((state) => {
    if (!state.entity_id.startsWith("switch.")) return false;
    const text = `${state.entity_id} ${String(state.attributes.friendly_name ?? "")}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

/**
 * The watchdog and the command path must resolve the SAME climate entity: a
 * signature computed from a different device than Auto is driving would make
 * the safety monitor watch the wrong thing. Both therefore go through here with
 * the same instance.
 */
export function airconSignature(states: HaState[], unit: AirconInstance) {
  const aircon = airconEntityFor(states, unit);
  if (!aircon || ["unknown", "unavailable"].includes((aircon as HaState).state)) return null;
  const quiet = findNamedSwitch(states, ["quiet"]);
  const turbo = findNamedSwitch(states, ["turbo"]);
  return JSON.stringify({
    power: aircon.state,
    target: Number(aircon.attributes.temperature ?? null),
    fan: aircon.attributes.fan_mode ?? null,
    swing: aircon.attributes.swing_mode ?? null,
    quiet: quiet?.state ?? null,
    turbo: turbo?.state ?? null,
  });
}

export function heaterSignature(switchState?: HaState) {
  return switchState && !["unknown", "unavailable"].includes(switchState.state)
    ? JSON.stringify({ power: switchState.state })
    : null;
}

/**
 * This unit's climate entity: bound explicitly when the home says which one,
 * otherwise matched by name. Explicit binding is what makes more than one air
 * conditioner possible, since name matching alone cannot tell two apart.
 */
export function airconEntityFor(states: HaState[], unit: AirconInstance) {
  if (unit.entityId) {
    return states.find((state) => state.entity_id === unit.entityId);
  }
  return dashboardAirconEntity(states, unit.matchTokens) as HaState | undefined;
}

/** Both room sensors configured: Dry can be emulated on a unit without it. */
function airconRoomHasDrySensors(unit: AirconInstance) {
  return (unit.humidityEntityIds ?? []).some((id) => id.trim()) && (unit.temperatureEntityIds ?? []).some((id) => id.trim());
}

export function airconSupportedModes(aircon: DashboardEntity | undefined) {
  const modes = aircon?.attributes?.hvac_modes;
  return Array.isArray(modes) ? modes.map(String) : [];
}

export function emulatesDry(unit: AirconInstance, aircon: HaState | DashboardEntity | undefined) {
  return airconDrySupport(airconSupportedModes(aircon as DashboardEntity | undefined), airconRoomHasDrySensors(unit)) === "emulated";
}

export function heaterEntityFor(states: HaState[], instance: HeaterInstance) {
  return instance.switchEntityIds.map((id) => states.find((state) => state.entity_id === id)).find(Boolean);
}

export function heaterSensorFor(states: HaState[], instance: HeaterInstance) {
  return roomTemperatureEntityIds(instance.temperatureEntityIds)
    .map((id) => states.find((state) => state.entity_id === id))
    .find(Boolean);
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function noteSample(samples: number[], value: number | null) {
  if (value === null || !Number.isFinite(value)) return;
  samples.push(value);
  while (samples.length > 5) samples.shift();
}

export function pruneStarts(room: PersistedRoom, now: number) {
  room.recentStartsAt = room.recentStartsAt.filter((at) => now - at < AIRCON_START_WINDOW_MS);
}

/**
 * The signature this instance is watched by. Which fields matter depends on the
 * device kind, not on which room it is in.
 */
export function signatureFor(instance: ClimateInstance, states: HaState[], entityId?: string) {
  return instance.kind === "aircon"
    ? airconSignature(states, instance)
    : heaterSignature(states.find((state) => state.entity_id === entityId));
}

