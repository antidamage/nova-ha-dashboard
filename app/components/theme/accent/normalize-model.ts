"use client";

// Field-level normalisers for stored theme values.
import { normalizeNovaAvatarTheme, type NovaAvatarTheme } from "../../avatarThemeModel";
import { clamp, normalizeColor } from "./color-model";
import {
  CONTROL_SOUND_VOLUME_MAX,
  CONTROL_SOUND_VOLUME_MIN,
  DEFAULT_CONTROL_SOUND,
  DEFAULT_THEME_SCOPE,
  DEFAULT_THEME_SELECTION,
  FLUID_BACKGROUND_APEX_GLOW_DEFAULT,
  FLUID_BACKGROUND_APEX_GLOW_MAX,
  FLUID_BACKGROUND_APEX_GLOW_MIN,
  FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT,
  FLUID_BACKGROUND_FALLOFF_POWER_MAX,
  FLUID_BACKGROUND_FALLOFF_POWER_MIN,
  FLUID_BACKGROUND_HUE_SPREAD_DEFAULT,
  FLUID_BACKGROUND_HUE_SPREAD_MAX,
  FLUID_BACKGROUND_HUE_SPREAD_MIN,
  FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT,
  FLUID_BACKGROUND_PEAK_INTENSITY_MAX,
  FLUID_BACKGROUND_PEAK_INTENSITY_MIN,
  FLUID_BACKGROUND_TEXTURE_SCALE_DEFAULT,
  FLUID_BACKGROUND_TEXTURE_SCALE_MAX,
  FLUID_BACKGROUND_TEXTURE_SCALE_MIN,
  FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MAX,
  FLUID_BACKGROUND_WARP_AMPLITUDE_MIN,
  MAP_BUILDING_OPACITY_DEFAULT,
  MAP_BUILDING_OPACITY_MAX,
  MAP_BUILDING_OPACITY_MIN,
  MAP_LABEL_SIZE_DEFAULT,
  MAP_LABEL_SIZE_MAX,
  MAP_LABEL_SIZE_MIN,
  RADAR_OPACITY_DEFAULT,
  TASK_GLOW_INTENSITY_DEFAULT,
  TASK_GLOW_INTENSITY_MAX,
  TASK_GLOW_INTENSITY_MIN,
} from "./constants";
import { DEFAULT_THEME } from "./defaults";
import type {
  ControlSoundSettings,
  DesktopWallpaperSettings,
  FluidBackgroundSettings,
  KnobSkinMode,
  RadarPaletteMode,
  ThemeColorValue,
  ThemeConfigScope,
  ThemeSelection,
  ThemeVariant,
} from "./types";

export function normalizeRadarPaletteMode(value: unknown): RadarPaletteMode {
  return value === "spectrum" ? "spectrum" : "custom";
}

export function normalizeKnobSkin(value: unknown): KnobSkinMode {
  return value === "dark" || value === "light" ? value : "auto";
}

export function normalizeThemeScope(value: unknown): ThemeConfigScope {
  if (value === "local") {
    return "local";
  }
  if (value === "shared") {
    return "shared";
  }
  return DEFAULT_THEME_SCOPE;
}

export function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (value === "auto" || value === "dark" || value === "light") {
    return value;
  }
  return DEFAULT_THEME_SELECTION;
}

export function normalizeThemeVariant(value: unknown): ThemeVariant {
  return value === "light" ? "light" : "dark";
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(Math.round(parsed), min, max);
}

export function normalizePercent(value: unknown, fallback: number) {
  return normalizeNumber(value, fallback, 0, 100);
}

export function normalizeMapLabelSize(value: unknown) {
  return normalizeNumber(value, MAP_LABEL_SIZE_DEFAULT, MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX);
}

export function normalizeMapBuildingOpacity(value: unknown) {
  return normalizeNumber(value, MAP_BUILDING_OPACITY_DEFAULT, MAP_BUILDING_OPACITY_MIN, MAP_BUILDING_OPACITY_MAX);
}

export function normalizeRadarOpacity(value: unknown) {
  return normalizePercent(value, RADAR_OPACITY_DEFAULT);
}

export function normalizeTaskGlowIntensity(value: unknown) {
  return normalizeNumber(value, TASK_GLOW_INTENSITY_DEFAULT, TASK_GLOW_INTENSITY_MIN, TASK_GLOW_INTENSITY_MAX);
}

function normalizeBackgroundTextureUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

export function normalizeFluidBackgroundSettings(value: Partial<FluidBackgroundSettings> | null | undefined): FluidBackgroundSettings {
  return {
    apexGlow: normalizeNumber(value?.apexGlow, FLUID_BACKGROUND_APEX_GLOW_DEFAULT, FLUID_BACKGROUND_APEX_GLOW_MIN, FLUID_BACKGROUND_APEX_GLOW_MAX),
    falloffPower: normalizeNumber(value?.falloffPower, FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT, FLUID_BACKGROUND_FALLOFF_POWER_MIN, FLUID_BACKGROUND_FALLOFF_POWER_MAX),
    hueSpread: normalizeNumber(value?.hueSpread, FLUID_BACKGROUND_HUE_SPREAD_DEFAULT, FLUID_BACKGROUND_HUE_SPREAD_MIN, FLUID_BACKGROUND_HUE_SPREAD_MAX),
    peakIntensity: normalizeNumber(value?.peakIntensity, FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT, FLUID_BACKGROUND_PEAK_INTENSITY_MIN, FLUID_BACKGROUND_PEAK_INTENSITY_MAX),
    textureScale: normalizeNumber(value?.textureScale, FLUID_BACKGROUND_TEXTURE_SCALE_DEFAULT, FLUID_BACKGROUND_TEXTURE_SCALE_MIN, FLUID_BACKGROUND_TEXTURE_SCALE_MAX),
    textureUrl: normalizeBackgroundTextureUrl(value?.textureUrl),
    warpAmplitude: normalizeNumber(value?.warpAmplitude, FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT, FLUID_BACKGROUND_WARP_AMPLITUDE_MIN, FLUID_BACKGROUND_WARP_AMPLITUDE_MAX),
  };
}

function normalizeWallpaperAssetId(value: unknown) {
  return typeof value === "string" && /^wallpaper_[a-f0-9-]{36}$/.test(value) ? value : null;
}

export function normalizeDesktopWallpaperSettings(value: Partial<DesktopWallpaperSettings> | null | undefined): DesktopWallpaperSettings {
  return {
    ipadAssetId: normalizeWallpaperAssetId(value?.ipadAssetId),
    landscapeAssetId: normalizeWallpaperAssetId(value?.landscapeAssetId),
    portraitAssetId: normalizeWallpaperAssetId(value?.portraitAssetId),
    useAsDashboardBackground: value?.useAsDashboardBackground === true,
  };
}

export function normalizeControlSound(value: Partial<ControlSoundSettings> | null | undefined): ControlSoundSettings {
  return {
    volume: normalizeNumber(value?.volume, DEFAULT_CONTROL_SOUND.volume, CONTROL_SOUND_VOLUME_MIN, CONTROL_SOUND_VOLUME_MAX),
  };
}

export function normalizeThemeAvatar(value: unknown) {
  const avatar = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<NovaAvatarTheme>
    : null;

  return normalizeNovaAvatarTheme(avatar ?? DEFAULT_THEME.avatar);
}

export function matchesThemeColor(value: Partial<ThemeColorValue> | null | undefined, expected: ThemeColorValue) {
  if (!value) {
    return false;
  }

  const normalized = normalizeColor(value, expected);
  return normalized.intensity === expected.intensity
    && normalized.rgb.every((part, index) => part === expected.rgb[index]);
}
