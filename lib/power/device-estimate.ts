// Per-device wattage estimates from Home Assistant state and configured ratings.
import type { PowerDeviceRating } from "../config-schema";
import type { HaState } from "../types";
import { round } from "./numbers";
import { powerConfig } from "./store";
import type { PersistedDeviceState, PowerDeviceReading } from "./types";

// Device ratings come from `power.deviceRatings` in dashboard config. They used
// to be a table in this file mirrored to data/power/device-ratings.json, which
// meant a device could be listed in one place and not the other: the on-disk
// copy silently outranked the source, and removing a device from only the table
// left it resurrected. One config document, one answer.
export function readRatings(): PowerDeviceRating[] {
  return powerConfig().deviceRatings;
}

function stateIsLive(state?: HaState) {
  return Boolean(state && !["unknown", "unavailable"].includes(String(state.state)));
}

function firstLiveState(statesById: Map<string, HaState>, entityIds: string[]) {
  return entityIds.map((entityId) => statesById.get(entityId)).find(stateIsLive) ?? statesById.get(entityIds[0]);
}

export function numericState(statesById: Map<string, HaState>, entityId?: string) {
  if (!entityId) {
    return null;
  }
  const value = Number(statesById.get(entityId)?.state);
  return Number.isFinite(value) ? value : null;
}

function brightnessFactor(state: HaState) {
  const brightness = Number(state.attributes?.brightness);
  if (!Number.isFinite(brightness)) {
    return 1;
  }
  return Math.max(0.08, Math.min(1, brightness / 255));
}

function colorFactor(state: HaState) {
  const rgb = state.attributes?.rgb_color;
  if (!Array.isArray(rgb) || rgb.length < 3) {
    return 1;
  }
  const values = rgb.slice(0, 3).map(Number).filter(Number.isFinite);
  if (values.length < 3) {
    return 1;
  }
  const max = Math.max(...values, 1);
  const whiteMix = values.reduce((sum, value) => sum + value, 0) / (3 * max);
  return Math.max(0.62, Math.min(1, 0.62 + whiteMix * 0.38));
}

function climateWatts(rating: PowerDeviceRating, state: HaState) {
  if (state.state === "off") {
    return rating.standbyWatts ?? 0;
  }
  if (!stateIsLive(state)) {
    return 0;
  }

  const mode = String(state.state);
  if (mode === "fan_only") {
    return Math.min(120, rating.ratedWatts * 0.08);
  }
  if (mode === "dry") {
    return Math.min(rating.ratedWatts, 550);
  }

  if (rating.id === "gree_aircon") {
    return mode === "cool" ? rating.coolInputWatts ?? rating.ratedWatts : rating.heatInputWatts ?? rating.ratedWatts;
  }

  const target = Number(state.attributes?.temperature);
  const current = Number(state.attributes?.current_temperature);
  const hasTemperatures = Number.isFinite(target) && Number.isFinite(current);
  const rawDelta =
    mode === "cool"
      ? hasTemperatures
        ? current - target
        : 1
      : hasTemperatures
        ? target - current
        : 1;

  const load = hasTemperatures ? Math.max(0.25, Math.min(1, 0.28 + Math.max(0, rawDelta) * 0.22)) : 0.55;
  const rated = mode === "cool" ? rating.coolInputWatts ?? rating.ratedWatts : rating.heatInputWatts ?? rating.ratedWatts;
  const watts = Math.max(rating.standbyWatts ?? 0, rated * load);

  if (rating.id === "panel_heater" && hasTemperatures && rawDelta <= 0) {
    return 120;
  }

  return Math.min(rating.maxWatts ?? rating.ratedWatts, watts);
}

export function estimateDevice(rating: PowerDeviceRating, statesById: Map<string, HaState>, persisted?: PersistedDeviceState): PowerDeviceReading {
  const measured = numericState(statesById, rating.powerSensorEntityId);
  const state = firstLiveState(statesById, rating.entityIds);
  let watts = 0;
  const stateName = state?.state ?? "missing";

  if (measured !== null) {
    watts = measured;
  } else if (!state || !stateIsLive(state)) {
    watts = 0;
  } else if (rating.kind === "climate") {
    watts = climateWatts(rating, state);
  } else if (state.state === "on") {
    watts = (rating.standbyWatts ?? 0) + rating.ratedWatts * brightnessFactor(state) * colorFactor(state);
  } else {
    watts = rating.standbyWatts ?? 0;
  }

  return {
    confidence: rating.confidence,
    entityId: state?.entity_id ?? null,
    id: rating.id,
    kwhTotal: persisted?.kwhTotal ?? 0,
    name: rating.name,
    notes: rating.notes,
    ratedWatts: rating.ratedWatts,
    source: rating.source,
    state: stateName,
    watts: round(watts, 2),
    zone: rating.zone,
  };
}
