// Pure lighting helpers: what a light supports, preset payloads, pinned
// fixtures, and the brightness/threshold plans the actions execute.
import type { DashboardEntity, DashboardState, DashboardZone, SunStatus } from "../../types";
import { isEntitySuppressedByIntensity } from "../../lighting-thresholds";
import {
  adaptiveLightBrightnessPctForEntity,
  adaptiveLightColorTemperatureKelvinForEntity,
  adaptiveLightMode,
  adaptiveLightPreset,
  defaultAdaptiveLightBrightnessPct,
  isPinnedLightEntity,
  DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
  type AdaptiveLightMode,
  type LightPreset,
} from "../../lighting-presets";
import { isEntityOn } from "../../entity-semantics";
import { DEFAULT_SUPPORT_SWITCH_RE } from "../entities";
import { lightLayerEntities } from "../zones";
import type { AdaptiveSunState } from "./types";

// Default "hidden switch" pattern for the lighting action path; the entity
// projection uses the configured pattern (see lib/ha/entities).
const SUPPORT_SWITCH_RE = DEFAULT_SUPPORT_SWITCH_RE;
const WARM_WHITE_KELVIN = 3000;

// Hidden/support switches are removed during entity projection; this lighting
// action helper guards again defensively using the generic pattern.
export function isSupportSwitch(entity: Pick<DashboardEntity, "domain" | "entity_id" | "name">, pattern = SUPPORT_SWITCH_RE) {
  if (entity.domain !== "switch") {
    return false;
  }

  return pattern.test(`${entity.name} ${entity.entity_id.replaceAll("_", " ")}`);
}

function supportedModes(entity: DashboardEntity) {
  const modes = entity.attributes.supported_color_modes;
  return Array.isArray(modes) ? modes.map(String) : [];
}

export function supportsBrightness(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["brightness", "color_temp", "hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

export function supportsColor(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  return modes.some((mode) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode));
}

export function numericAttribute(entity: DashboardEntity, name: string) {
  const value = Number(entity.attributes[name]);
  return Number.isFinite(value) ? value : null;
}

export function miredToKelvin(value: number) {
  return Math.round(1_000_000 / value);
}

function colorTempKelvinRange(entity: DashboardEntity) {
  const maxMireds = numericAttribute(entity, "max_mireds");
  const minMireds = numericAttribute(entity, "min_mireds");
  const minKelvin = numericAttribute(entity, "min_color_temp_kelvin") ?? (maxMireds ? miredToKelvin(maxMireds) : null);
  const maxKelvin = numericAttribute(entity, "max_color_temp_kelvin") ?? (minMireds ? miredToKelvin(minMireds) : null);

  return { minKelvin, maxKelvin };
}

function supportsColorTemp(entity: DashboardEntity) {
  const modes = supportedModes(entity);
  const range = colorTempKelvinRange(entity);
  return modes.includes("color_temp") || range.minKelvin !== null || range.maxKelvin !== null;
}

function clampKelvinForEntity(entity: DashboardEntity, kelvin: number) {
  const range = colorTempKelvinRange(entity);
  return Math.max(range.minKelvin ?? kelvin, Math.min(range.maxKelvin ?? kelvin, kelvin));
}

function presetColorTempKelvin(entity: DashboardEntity, preset: LightPreset) {
  if (preset === "candlelight") {
    return colorTempKelvinRange(entity).minKelvin ?? 1800;
  }
  if (preset === "warm-white") {
    return clampKelvinForEntity(entity, WARM_WHITE_KELVIN);
  }
  return colorTempKelvinRange(entity).maxKelvin ?? 6500;
}

function presetRgb(preset: LightPreset): [number, number, number] {
  if (preset === "candlelight") {
    return [255, 147, 41];
  }
  if (preset === "warm-white") {
    return [255, 214, 170];
  }
  return [255, 255, 255];
}

export function normalizedSunState(sun?: SunStatus | null): AdaptiveSunState | null {
  return sun?.state === "above_horizon" || sun?.state === "below_horizon" ? sun.state : null;
}

export function adaptiveCandlelightPreset(sun?: SunStatus | null): LightPreset {
  return adaptiveLightPreset(sun);
}

export function adaptiveCandlelightBrightnessPct(sun?: SunStatus | null) {
  return defaultAdaptiveLightBrightnessPct(sun);
}

export function addLightPresetToPayload(
  entity: DashboardEntity,
  payload: Record<string, unknown>,
  preset: LightPreset,
  lighting: DashboardState["lighting"],
  mode?: AdaptiveLightMode,
) {
  const colorTemperatureOverrideKelvin =
    preset === "white" ? null : adaptiveLightColorTemperatureKelvinForEntity(entity, lighting, mode);
  if (colorTemperatureOverrideKelvin !== null) {
    if (supportsColorTemp(entity)) {
      payload.color_temp_kelvin = clampKelvinForEntity(entity, colorTemperatureOverrideKelvin);
    } else if (supportsColor(entity)) {
      payload.rgb_color = [255, 255, 255];
    }
    return;
  }

  if (supportsColorTemp(entity)) {
    payload.color_temp_kelvin = presetColorTempKelvin(entity, preset);
  } else if (supportsColor(entity)) {
    payload.rgb_color = presetRgb(preset);
  }
}

/**
 * If the entity is a pinned light, fill `payload` with its fixed preset
 * (brightness + warm colour) and return true so callers skip whatever
 * brightness/colour the zone command would otherwise apply. This is how a
 * fixture like the conservatory stays warm-white at full brightness no matter
 * how the rest of the room is set, and how it gets reapplied on every edit.
 */
export function applyPinnedPreset(
  entity: DashboardEntity,
  payload: Record<string, unknown>,
  lighting: DashboardState["lighting"],
  sun?: SunStatus | null,
): boolean {
  if (!isPinnedLightEntity(entity, lighting)) {
    return false;
  }

  const mode = adaptiveLightMode(sun);
  if (supportsBrightness(entity)) {
    payload.brightness_pct = adaptiveLightBrightnessPctForEntity(
      entity,
      lighting,
      mode,
      DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT,
    );
  }

  const overrideKelvin = adaptiveLightColorTemperatureKelvinForEntity(entity, lighting, mode);
  if (overrideKelvin !== null) {
    if (supportsColorTemp(entity)) {
      payload.color_temp_kelvin = clampKelvinForEntity(entity, overrideKelvin);
    } else if (supportsColor(entity)) {
      payload.rgb_color = [255, 255, 255];
    }
  } else {
    // Pinned without an explicit colour override defaults to warm white.
    addLightPresetToPayload(entity, payload, "warm-white", lighting, mode);
  }

  return true;
}

export function uniqueDashboardEntities<T extends DashboardEntity>(entities: T[]) {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    if (seen.has(entity.entity_id)) {
      return false;
    }
    seen.add(entity.entity_id);
    return true;
  });
}

export function clampTurnOnBrightnessPct(value: unknown, fallback: number) {
  const pct = Number(value);
  if (!Number.isFinite(pct) || pct <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.round(pct)));
}

export function splitLightsByPresetBrightness<T extends DashboardEntity>(
  lights: T[],
  lighting: DashboardState["lighting"],
  mode: AdaptiveLightMode,
  fallbackBrightnessPct: number,
) {
  return lights.reduce(
    (groups, entity) => {
      const brightnessPct = adaptiveLightBrightnessPctForEntity(entity, lighting, mode, fallbackBrightnessPct);
      if (isEntitySuppressedByIntensity(entity, brightnessPct, lighting)) {
        groups.suppressed.push(entity);
      } else {
        groups.active.push({ entity, brightnessPct });
      }
      return groups;
    },
    { active: [] as Array<{ entity: T; brightnessPct: number }>, suppressed: [] as T[] },
  );
}

function zonesForThresholdEntity(dashboard: DashboardState, entityId: string) {
  const zones = dashboard.zones.filter((zone) => zone.entities.some((entity) => entity.entity_id === entityId));
  const specificZones = zones.filter((zone) => zone.id !== "everything" && !zone.special);
  return specificZones.length ? specificZones : zones;
}

export function zoneHasActiveLighting(zone: DashboardZone) {
  return lightLayerEntities(zone.entities).some(isEntityOn);
}

export function targetZoneForThresholdEntity(dashboard: DashboardState, entityId: string) {
  const zones = zonesForThresholdEntity(dashboard, entityId);
  return zones.find(zoneHasActiveLighting) ?? zones[0] ?? null;
}
