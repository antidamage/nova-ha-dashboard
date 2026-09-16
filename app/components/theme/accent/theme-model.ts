"use client";

// Whole-theme normalisation and the theme-set fallback chain.
import { normalizeUxSounds } from "../../dashboard/uxSoundActions";
import { DEFAULT_CLOCK_FONT_ID, DEFAULT_THEME_FONT_ID } from "../../themeFonts";
import { appliedThemeRgb, clamp, normalizeColor, panelColorSeedFromBackground, titleColorSlotFor } from "./color-model";
import {
  DEFAULT_THEME_SELECTION,
  LIGHTING_TINT_STRENGTH_DEFAULT,
  LIGHTING_TINT_STRENGTH_MAX,
  LIGHTING_TINT_STRENGTH_MIN,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN,
  VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT,
  VOICE_TRANSCRIPT_GLOW_SIZE_MAX,
  VOICE_TRANSCRIPT_GLOW_SIZE_MIN,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN,
} from "./constants";
import {
  DEFAULT_CLOCK_FONT_SETTING,
  DEFAULT_DARK_THEME,
  DEFAULT_DISPLAY_FONT_SETTING,
  DEFAULT_GYM_FONT_SETTING,
  DEFAULT_LIGHT_THEME,
  DEFAULT_THEME,
  DEFAULT_THEME_SET,
  DEFAULT_TRANSCRIPT_FONT_SETTING,
} from "./defaults";
import { normalizeThemeFontSetting } from "./font-scale";
import {
  matchesThemeColor,
  normalizeControlSound,
  normalizeDesktopWallpaperSettings,
  normalizeFluidBackgroundSettings,
  normalizeKnobSkin,
  normalizeMapBuildingOpacity,
  normalizeMapLabelSize,
  normalizeNumber,
  normalizePercent,
  normalizeRadarOpacity,
  normalizeRadarPaletteMode,
  normalizeTaskGlowIntensity,
  normalizeThemeAvatar,
  normalizeThemeSelection,
  recordValue,
} from "./normalize-model";
import type {
  DeviceTheme,
  DeviceThemeSet,
  StoredMapTheme,
  ThemeColorValue,
  ThemeStorageValue,
  ThemeTitleTone,
} from "./types";

export function normalizeTheme(value: Partial<DeviceTheme & ThemeColorValue> | null | undefined): DeviceTheme {
  const storedAccent = value?.accent ?? (Array.isArray(value?.rgb) ? value : null);
  const titleTone = ["auto", "light", "dark"].includes(String(value?.titleTone))
    ? (value?.titleTone as ThemeTitleTone)
    : DEFAULT_THEME.titleTone;
  const borderValue = value?.border;
  const headerFadeValue = value?.headerFade;
  const panelValue = value?.panel;
  const mapWaterValue = value?.mapWater;
  const mapValue = value?.map as StoredMapTheme | null | undefined;
  const buildingLowValue = mapValue?.buildingLow ?? mapValue?.buildings;
  const buildingHighValue = matchesThemeColor(mapValue?.buildingHigh, {
    cursor: { x: 0.5, y: 0.0 },
    intensity: 100,
    rgb: [40, 243, 255],
  }) ? undefined : mapValue?.buildingHigh;
  const waterValue = matchesThemeColor(mapValue?.water, {
    cursor: { x: 0.55, y: 0.94 },
    intensity: 12,
    rgb: [217, 233, 242],
  }) ? undefined : mapValue?.water;
  const roadsValue = mapValue?.roads ?? mapValue?.majorRoads ?? mapValue?.minorRoads;
  const background = normalizeColor(value?.background, DEFAULT_THEME.background);
  const titleColors = {
    dark: normalizeColor(value?.titleColors?.dark, DEFAULT_THEME.titleColors.dark),
    light: normalizeColor(value?.titleColors?.light, DEFAULT_THEME.titleColors.light),
  };

  return {
    accent: normalizeColor(storedAccent, DEFAULT_THEME.accent),
    highlight: normalizeColor(value?.highlight, DEFAULT_THEME.highlight),
    avatar: normalizeThemeAvatar(value?.avatar),
    background,
    backgroundEffect: normalizeFluidBackgroundSettings(value?.backgroundEffect),
    clockColor: normalizeColor(value?.clockColor, titleColors[titleColorSlotFor(titleTone, appliedThemeRgb(background), true)]),
    clockFont: normalizeThemeFontSetting(value?.clockFont, DEFAULT_CLOCK_FONT_ID, DEFAULT_CLOCK_FONT_SETTING.weight),
    controlSound: normalizeControlSound(value?.controlSound),
    uxSounds: normalizeUxSounds(value?.uxSounds),
    desktopWallpaper: normalizeDesktopWallpaperSettings(value?.desktopWallpaper),
    font: normalizeThemeFontSetting(value?.font, DEFAULT_THEME_FONT_ID, DEFAULT_DISPLAY_FONT_SETTING.weight),
    gymFont: normalizeThemeFontSetting(value?.gymFont, DEFAULT_THEME_FONT_ID, DEFAULT_GYM_FONT_SETTING.weight),
    transcriptFont: normalizeThemeFontSetting(value?.transcriptFont, DEFAULT_THEME_FONT_ID, DEFAULT_TRANSCRIPT_FONT_SETTING.weight),
    border: {
      color: normalizeColor(borderValue?.color, DEFAULT_THEME.border.color),
      opacity: clamp(Math.round(Number(borderValue?.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
    },
    headerFade: {
      color: normalizeColor(headerFadeValue?.color, DEFAULT_THEME.headerFade.color),
      opacity: clamp(Math.round(Number(headerFadeValue?.opacity ?? DEFAULT_THEME.headerFade.opacity)), 0, 100),
    },
    panel: {
      color: normalizeColor(panelValue?.color, panelColorSeedFromBackground(background)),
      opacity: clamp(Math.round(Number(panelValue?.opacity ?? 100)), 0, 100),
    },
    map: {
      base: normalizeColor(mapValue?.base, DEFAULT_THEME.map.base),
      water: normalizeColor(waterValue, DEFAULT_THEME.map.water),
      land: normalizeColor(mapValue?.land, DEFAULT_THEME.map.land),
      buildingLow: normalizeColor(buildingLowValue, DEFAULT_THEME.map.buildingLow),
      buildingHigh: normalizeColor(buildingHighValue, DEFAULT_THEME.map.buildingHigh),
      roads: normalizeColor(roadsValue, DEFAULT_THEME.map.roads),
      labels: normalizeColor(mapValue?.labels, DEFAULT_THEME.map.labels),
      radarLow: normalizeColor(mapValue?.radarLow, DEFAULT_THEME.map.radarLow),
      radarHigh: normalizeColor(mapValue?.radarHigh, DEFAULT_THEME.map.radarHigh),
    },
    knobSkin: normalizeKnobSkin(value?.knobSkin),
    ledColor: normalizeColor(value?.ledColor, DEFAULT_THEME.ledColor),
    mapBuildingOpacity: normalizeMapBuildingOpacity(value?.mapBuildingOpacity),
    mapLabelSize: normalizeMapLabelSize(value?.mapLabelSize),
    mapSatellite: value?.mapSatellite !== false,
    lightingTint: value?.lightingTint === true,
    lightingTintStrength: normalizeNumber(value?.lightingTintStrength, LIGHTING_TINT_STRENGTH_DEFAULT, LIGHTING_TINT_STRENGTH_MIN, LIGHTING_TINT_STRENGTH_MAX),
    mapWater: {
      enabled: mapWaterValue?.enabled !== false,
      opacity: normalizePercent(mapWaterValue?.opacity, DEFAULT_THEME.mapWater.opacity),
    },
    radarOpacity: normalizeRadarOpacity(value?.radarOpacity),
    radarPaletteMode: normalizeRadarPaletteMode(value?.radarPaletteMode),
    taskGlowIntensity: normalizeTaskGlowIntensity(value?.taskGlowIntensity),
    titleColors: {
      ...titleColors,
    },
    titleTone,
    voiceTranscriptColors: {
      background: normalizeColor(value?.voiceTranscriptColors?.background, DEFAULT_THEME.voiceTranscriptColors.background),
      glowIntensity: normalizeNumber(value?.voiceTranscriptColors?.glowIntensity, VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT, VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN, VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX),
      glowSize: normalizeNumber(value?.voiceTranscriptColors?.glowSize, VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT, VOICE_TRANSCRIPT_GLOW_SIZE_MIN, VOICE_TRANSCRIPT_GLOW_SIZE_MAX),
      scanlineOpacity: normalizeNumber(value?.voiceTranscriptColors?.scanlineOpacity, VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT, VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN, VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX),
      scanlineScale: normalizeNumber(value?.voiceTranscriptColors?.scanlineScale, VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT, VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN, VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX),
      text: normalizeColor(value?.voiceTranscriptColors?.text, DEFAULT_THEME.voiceTranscriptColors.text),
    },
  };
}

function hasNamespacedThemes(value: unknown) {
  const record = recordValue(value);
  return Boolean(recordValue(record?.themes));
}

function defaultThemeSet(): DeviceThemeSet {
  return {
    selection: DEFAULT_THEME_SELECTION,
    themes: {
      dark: normalizeTheme(DEFAULT_DARK_THEME),
      light: normalizeTheme(DEFAULT_LIGHT_THEME),
    },
  };
}

function normalizeThemeSetWithFallback(value: ThemeStorageValue | null | undefined, fallback: DeviceThemeSet): DeviceThemeSet {
  const record = recordValue(value);
  if (!record) {
    return fallback;
  }

  const themesRecord = recordValue(record.themes);
  if (!themesRecord) {
    const legacyTheme = normalizeTheme(value as Partial<DeviceTheme & ThemeColorValue>);
    return {
      selection: normalizeThemeSelection(record.selection ?? fallback.selection),
      themes: {
        dark: legacyTheme,
        light: legacyTheme,
      },
    };
  }

  return {
    selection: normalizeThemeSelection(record.selection ?? fallback.selection),
    themes: {
      dark: normalizeTheme((themesRecord.dark ?? fallback.themes.dark) as Partial<DeviceTheme & ThemeColorValue>),
      light: normalizeTheme((themesRecord.light ?? fallback.themes.light) as Partial<DeviceTheme & ThemeColorValue>),
    },
  };
}

export function normalizeThemeSet(
  value: ThemeStorageValue | null | undefined,
  fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET,
): DeviceThemeSet {
  const baseFallback = hasNamespacedThemes(fallback)
    ? normalizeThemeSetWithFallback(fallback, defaultThemeSet())
    : {
        selection: DEFAULT_THEME_SELECTION,
        themes: {
          dark: normalizeTheme(fallback as Partial<DeviceTheme & ThemeColorValue> | null | undefined),
          light: normalizeTheme(fallback as Partial<DeviceTheme & ThemeColorValue> | null | undefined),
        },
      };

  return normalizeThemeSetWithFallback(value, baseFallback);
}
