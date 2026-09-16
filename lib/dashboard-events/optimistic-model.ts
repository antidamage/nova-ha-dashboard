// Pure optimistic dashboard state for lighting, house-party and entity
// actions, applied before Home Assistant confirms the change.

import {
  adaptiveLightBrightnessPctForEntity,
  adaptiveLightColorTemperatureKelvinForEntity,
  adaptiveLightMode,
} from "../lighting-presets";
import { isEntitySuppressedByIntensity } from "../lighting-thresholds";
import type { DashboardEntity, DashboardLightingConfig, DashboardState } from "../types";
import type { EntityActionInput, ZoneActionInput } from "./types";

function isDashboardEntityOn(entity: DashboardEntity) {
  if (["unavailable", "unknown"].includes(entity.state)) {
    return false;
  }
  if (entity.domain === "climate") {
    return entity.state !== "off";
  }
  return ["on", "open", "opening", "playing", "heat", "cool", "heat_cool"].includes(entity.state);
}

function brightnessPctFromEntities(entities: DashboardEntity[]) {
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

function brightnessAttributeFromPct(value: unknown) {
  const brightnessPct = Number(value);
  if (!Number.isFinite(brightnessPct)) {
    return null;
  }

  return Math.round((Math.max(0, Math.min(100, brightnessPct)) / 100) * 255);
}

function numberArray(value: unknown, length: number) {
  if (!Array.isArray(value) || value.length < length) {
    return null;
  }

  const numbers = value.slice(0, length).map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

function withDashboardEntityUpdates(
  state: DashboardState,
  updateEntity: (entity: DashboardEntity) => DashboardEntity,
) {
  const entities = state.entities.map(updateEntity);
  const entityById = new Map(entities.map((entity) => [entity.entity_id, entity]));

  return {
    ...state,
    entities,
    zones: state.zones.map((zone) => {
      const zoneEntities = zone.entities.map((entity) => entityById.get(entity.entity_id) ?? entity);
      return {
        ...zone,
        entities: zoneEntities,
        isOn: zoneEntities.some(isDashboardEntityOn),
        brightnessPct: brightnessPctFromEntities(zoneEntities),
      };
    }),
  };
}

function optimisticZoneEntity(
  entity: DashboardEntity,
  action: string,
  brightnessPct: number,
  rgb: [number, number, number] | null,
  lighting?: DashboardLightingConfig,
) {
  const brightness = brightnessAttributeFromPct(brightnessPct) ?? 255;
  const color = rgb ?? (action === "white" ? [255, 255, 255] : [255, 147, 41]);

  if (action !== "off" && isEntitySuppressedByIntensity(entity, brightnessPct, lighting)) {
    if (entity.domain === "light") {
      return { ...entity, state: "off", attributes: { ...entity.attributes, brightness: 0 } };
    }
    if (entity.domain === "switch") {
      return { ...entity, state: "off" };
    }
  }

  if (action === "off") {
    if (entity.domain === "light" || (entity.domain === "switch" && entity.isIllumination)) {
      return { ...entity, state: "off" };
    }
    return entity;
  }

  if (action === "brightness") {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: brightnessPct <= 0 ? "off" : "on",
        attributes: { ...entity.attributes, brightness },
      };
    }
    if (entity.domain === "switch" && entity.isIllumination) {
      return { ...entity, state: brightnessPct <= 0 ? "off" : "on" };
    }
    return entity;
  }

  if (["color", "on", "candlelight", "white"].includes(action)) {
    if (entity.domain === "light") {
      return {
        ...entity,
        state: "on",
        attributes: { ...entity.attributes, brightness, rgb_color: color },
      };
    }
    if (entity.domain === "switch" && (entity.isIllumination || action === "on")) {
      return { ...entity, state: "on" };
    }
  }

  return entity;
}

function adaptiveCandlelightRgb(state: DashboardState): [number, number, number] {
  return state.sun?.state === "below_horizon" ? [255, 147, 41] : [255, 214, 170];
}

function optimisticAdaptiveBrightnessPct(entity: DashboardEntity, action: string, brightnessPct: number, state: DashboardState) {
  if (entity.domain !== "light" || !["on", "candlelight"].includes(action)) {
    return brightnessPct;
  }
  return adaptiveLightBrightnessPctForEntity(entity, state.lighting, adaptiveLightMode(state.sun), brightnessPct);
}

function optimisticAdaptiveRgb(
  entity: DashboardEntity,
  action: string,
  rgb: [number, number, number] | null,
  state: DashboardState,
) {
  if (entity.domain !== "light" || !["on", "candlelight"].includes(action)) {
    return rgb;
  }
  const kelvin = adaptiveLightColorTemperatureKelvinForEntity(entity, state.lighting, adaptiveLightMode(state.sun));
  return kelvin !== null && kelvin >= 5000 ? [255, 255, 255] as [number, number, number] : rgb;
}

export function isLightZoneAction(action: string) {
  return ["on", "off", "brightness", "color", "candlelight", "white"].includes(action);
}

export function optimisticDashboardStateForZoneAction(state: DashboardState, input: ZoneActionInput) {
  const zone = state.zones.find((candidate) => candidate.id === input.zoneId);
  if (!zone || !isLightZoneAction(input.action)) {
    return state;
  }

  const entityIds = new Set(zone.entities.map((entity) => entity.entity_id));
  const brightnessPct = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? zone.brightnessPct ?? 100)));
  const rgb = input.rgb ?? (["on", "candlelight"].includes(input.action) ? adaptiveCandlelightRgb(state) : null);

  return withDashboardEntityUpdates(state, (entity) =>
    entityIds.has(entity.entity_id)
      ? optimisticZoneEntity(
          entity,
          input.action,
          optimisticAdaptiveBrightnessPct(entity, input.action, brightnessPct, state),
          optimisticAdaptiveRgb(entity, input.action, rgb, state),
          state.lighting,
        )
      : entity,
  );
}

export function optimisticDashboardStateForLightingEntityIdsAction(
  state: DashboardState,
  input: Omit<ZoneActionInput, "zoneId"> & { entityIds: string[] },
) {
  if (!isLightZoneAction(input.action)) {
    return state;
  }

  const entityIds = new Set(input.entityIds);
  const brightnessPct = Math.max(0, Math.min(100, Math.round(input.brightnessPct ?? 100)));
  const rgb = input.rgb ?? (["on", "candlelight"].includes(input.action) ? adaptiveCandlelightRgb(state) : null);

  return withDashboardEntityUpdates(state, (entity) =>
    entityIds.has(entity.entity_id)
      ? optimisticZoneEntity(
          entity,
          input.action,
          optimisticAdaptiveBrightnessPct(entity, input.action, brightnessPct, state),
          optimisticAdaptiveRgb(entity, input.action, rgb, state),
          state.lighting,
        )
      : entity,
  );
}

export function optimisticDashboardStateForHouseParty(
  state: DashboardState,
  input: { entityIds: string[]; rgb: [number, number, number]; brightnessPct?: number },
) {
  const entityIds = new Set(input.entityIds);
  const brightness = typeof input.brightnessPct === "number"
    ? brightnessAttributeFromPct(Math.max(5, Math.min(100, input.brightnessPct)))
    : null;
  return withDashboardEntityUpdates(state, (entity) => {
    if (!entityIds.has(entity.entity_id) || entity.domain !== "light") return entity;
    return {
      ...entity,
      state: "on",
      attributes: {
        ...entity.attributes,
        rgb_color: input.rgb,
        ...(brightness === null ? {} : { brightness }),
      },
    };
  });
}

export function entityActionAffectsLighting(state: DashboardState, input: EntityActionInput) {
  if (input.domain === "light") {
    return true;
  }
  if (input.domain !== "switch") {
    return false;
  }

  return state.entities.some((entity) => entity.entity_id === input.entityId && entity.isIllumination);
}

export function optimisticDashboardStateForEntityAction(state: DashboardState, input: EntityActionInput) {
  if (!entityActionAffectsLighting(state, input)) {
    return state;
  }

  return withDashboardEntityUpdates(state, (entity) => {
    if (entity.entity_id !== input.entityId) {
      return entity;
    }

    let nextState = entity.state;
    let attributes = entity.attributes;
    const data = input.data ?? {};

    if (input.service === "turn_on") {
      nextState = "on";
    } else if (input.service === "turn_off") {
      nextState = "off";
    } else if (input.service === "toggle") {
      nextState = entity.state === "on" ? "off" : "on";
    }

    const brightness = brightnessAttributeFromPct(data.brightness_pct);
    if (brightness !== null) {
      attributes = { ...attributes, brightness };
      nextState = brightness <= 0 ? "off" : "on";
    }

    const rgb = numberArray(data.rgb_color, 3);
    if (rgb) {
      attributes = {
        ...attributes,
        rgb_color: rgb.slice(0, 3).map((part) => Math.max(0, Math.min(255, Math.round(part)))),
      };
      nextState = "on";
    }

    return { ...entity, state: nextState, attributes };
  });
}
