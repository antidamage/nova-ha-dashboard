import type { DashboardEntity, SunStatus } from "./types";

export const DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT = 60;
export const DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT = 100;
export const BRIGHT_WHITE_KELVIN = 6500;

export type AdaptiveLightMode = "candlelight" | "daylight";
export type LightPreset = "candlelight" | "warm-white" | "white";

type LightModeValue<T> = {
  candlelight?: T;
  daylight?: T;
  sunlight?: T;
};

type LightBrightnessTargets = {
  daytime?: number;
  evening?: number;
};

export type LightEntityPreset = {
  entityId: string;
  // When true the entity ignores whatever brightness/colour a zone command
  // would send and is always (re)driven to this preset instead — used for
  // fixtures that must stay at one look (e.g. a conservatory kept warm-white at
  // full brightness regardless of how the rest of the room is set).
  pinned?: boolean;
  targetBrightnessPct?: LightBrightnessTargets;
  colorTemperatureOverrideKelvin?: LightModeValue<number>;
};

export type LightingPresetConfig = {
  intensityThresholds?: unknown[];
  entityPresets?: LightEntityPreset[];
};

function clampPct(value: unknown, fallback: number) {
  const pct = Number(value);
  if (!Number.isFinite(pct)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, Math.round(pct)));
}

function entityPresetFor(entity: Pick<DashboardEntity, "entity_id">, lighting?: LightingPresetConfig) {
  return (lighting?.entityPresets ?? []).find((preset) => preset.entityId.trim() === entity.entity_id) ?? null;
}

/**
 * A pinned light always uses its configured preset and ignores the brightness/
 * colour a zone command would otherwise apply. Pinning is the config-level
 * mechanism behind "this fixture must always look the same".
 */
export function isPinnedLightEntity(
  entity: Pick<DashboardEntity, "entity_id">,
  lighting?: LightingPresetConfig,
) {
  return entityPresetFor(entity, lighting)?.pinned === true;
}

function isAdaptiveLightMode(value: unknown): value is AdaptiveLightMode {
  return value === "candlelight" || value === "daylight";
}

export function adaptiveLightMode(value?: AdaptiveLightMode | SunStatus | null): AdaptiveLightMode {
  if (isAdaptiveLightMode(value)) {
    return value;
  }
  return value?.state === "below_horizon" ? "candlelight" : "daylight";
}

export function adaptiveLightPreset(value?: AdaptiveLightMode | SunStatus | null): LightPreset {
  return adaptiveLightMode(value) === "candlelight" ? "candlelight" : "warm-white";
}

export function adaptiveLightLabel(value?: AdaptiveLightMode | SunStatus | null) {
  return adaptiveLightMode(value) === "candlelight" ? "Candlelight" : "Daylight";
}

export function defaultAdaptiveLightBrightnessPct(value?: AdaptiveLightMode | SunStatus | null) {
  return adaptiveLightMode(value) === "candlelight"
    ? DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT
    : DEFAULT_DAYTIME_LIGHT_BRIGHTNESS_PCT;
}

export function adaptiveLightBrightnessPctForEntity(
  entity: Pick<DashboardEntity, "entity_id">,
  lighting?: LightingPresetConfig,
  value?: AdaptiveLightMode | SunStatus | null,
  fallbackPct?: number,
) {
  const mode = adaptiveLightMode(value);
  const preset = entityPresetFor(entity, lighting);
  const configuredPct =
    mode === "candlelight"
      ? preset?.targetBrightnessPct?.evening
      : preset?.targetBrightnessPct?.daytime;

  return clampPct(configuredPct, clampPct(fallbackPct, defaultAdaptiveLightBrightnessPct(mode)));
}

export function adaptiveLightColorTemperatureKelvinForEntity(
  entity: Pick<DashboardEntity, "entity_id">,
  lighting?: LightingPresetConfig,
  value?: AdaptiveLightMode | SunStatus | null,
) {
  const mode = adaptiveLightMode(value);
  const override = entityPresetFor(entity, lighting)?.colorTemperatureOverrideKelvin;
  const kelvin = mode === "candlelight" ? override?.candlelight : override?.daylight ?? override?.sunlight;
  const numericKelvin = Number(kelvin);

  return Number.isFinite(numericKelvin) ? Math.round(numericKelvin) : null;
}
