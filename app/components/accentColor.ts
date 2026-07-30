"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_NOVA_GLASS_SETTINGS,
  normalizeNovaAvatarTheme,
  type NovaAvatarTheme,
} from "./avatarThemeModel";
import { setActiveControlSound } from "./dashboard/controlSound";
import {
  isControlInteractionCoolingDown,
  markControlInteraction,
} from "./controlInteractionCooldown";
import {
  DEFAULT_CLOCK_FONT_ID,
  DEFAULT_THEME_FONT_ID,
  normalizeThemeFontId,
  themeFontStack,
} from "./themeFonts";

export type ThemeColorSlot = "accent" | "highlight";
export type ThemeConfigScope = "local" | "shared";
export type ThemeSelection = "auto" | "dark" | "light";
export type ThemeVariant = "dark" | "light";
export type ThemeTitleTone = "auto" | "light" | "dark";
export type RadarPaletteMode = "spectrum" | "custom";
export type MapThemeColorSlot = "base" | "water" | "land" | "buildingLow" | "buildingHigh" | "roads" | "labels" | "radarLow" | "radarHigh";

export type ThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

export type ThemeBorderValue = {
  color: ThemeColorValue;
  enabled: boolean;
  opacity: number;
};

export type ThemeTitleColors = {
  dark: ThemeColorValue;
  light: ThemeColorValue;
};

export type ThemeVoiceTranscriptColors = {
  background: ThemeColorValue;
  glowIntensity: number;
  glowSize: number;
  scanlineOpacity: number;
  scanlineScale: number;
  text: ThemeColorValue;
};

export type ThemeMapLayerValue = {
  enabled: boolean;
  opacity: number;
};

export type FluidBackgroundSettings = {
  apexGlow: number;
  falloffPower: number;
  hueSpread: number;
  peakIntensity: number;
  textureScale: number;
  textureUrl: string | null;
  warpAmplitude: number;
};

export type DesktopWallpaperSettings = {
  landscapeAssetId: string | null;
  portraitAssetId: string | null;
};

// A user-uploaded UI sound played when a control button commands a device. The
// audio is embedded as a data URL so it travels with the shared config and saved
// theme presets. `source` null means no sound (silent).
export type ControlSoundSettings = {
  name: string | null;
  source: string | null;
  volume: number;
};

// A font choice plus its weight and a small size nudge. Replaces the bare font-id
// strings so every font picker (theme/display, clock, gym readout, ...) can be
// driven by one reusable control. Legacy themes stored a plain id string; those
// are migrated by normalizeThemeFontSetting.
export type ThemeFontSetting = {
  id: string;
  weight: number;
  sizeOffset: number;
};

export const THEME_FONT_WEIGHT_MIN = 100;
export const THEME_FONT_WEIGHT_MAX = 900;
export const THEME_FONT_WEIGHT_STEP = 100;
export const THEME_FONT_WEIGHT_DEFAULT = 500;
export const THEME_FONT_SIZE_OFFSET_MIN = -100;
export const THEME_FONT_SIZE_OFFSET_MAX = 100;
// Size offset is a percentage of the base size (-100..+100 -> 0x..2x), so +50 is 1.5x.
const THEME_FONT_SIZE_OFFSET_RATIO = 0.01;
// Floor so an extreme negative offset never collapses the text to nothing.
const THEME_FONT_SIZE_MIN_SCALE = 0.05;

/** Font-size multiplier for a size offset (-100..+100 -> 0.05x..2x), seeded as a CSS var. */
export function themeFontSizeScale(sizeOffset: number): number {
  const bounded = clamp(Math.round(Number(sizeOffset) || 0), THEME_FONT_SIZE_OFFSET_MIN, THEME_FONT_SIZE_OFFSET_MAX);
  return Number(Math.max(THEME_FONT_SIZE_MIN_SCALE, 1 + bounded * THEME_FONT_SIZE_OFFSET_RATIO).toFixed(3));
}

function normalizeFontWeight(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(Math.round(parsed / THEME_FONT_WEIGHT_STEP) * THEME_FONT_WEIGHT_STEP, THEME_FONT_WEIGHT_MIN, THEME_FONT_WEIGHT_MAX);
}

function normalizeFontSizeOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return clamp(Math.round(parsed), THEME_FONT_SIZE_OFFSET_MIN, THEME_FONT_SIZE_OFFSET_MAX);
}

/** Accept a legacy id string OR a {id, weight, sizeOffset} object; return a full setting. */
export function normalizeThemeFontSetting(
  value: unknown,
  defaultId: string,
  defaultWeight: number = THEME_FONT_WEIGHT_DEFAULT,
): ThemeFontSetting {
  if (typeof value === "string") {
    return { id: normalizeThemeFontId(value, defaultId), weight: defaultWeight, sizeOffset: 0 };
  }
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return {
    id: normalizeThemeFontId(record?.id, defaultId),
    weight: normalizeFontWeight(record?.weight, defaultWeight),
    sizeOffset: normalizeFontSizeOffset(record?.sizeOffset),
  };
}

const DEFAULT_DISPLAY_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };
// Numbers/clock currently render bold (Tailwind font-black ~900); default to 900 so
// the migration preserves the existing look.
const DEFAULT_CLOCK_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_CLOCK_FONT_ID, weight: 900, sizeOffset: 0 };
const DEFAULT_GYM_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };
const DEFAULT_TRANSCRIPT_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };

export type DeviceTheme = Record<ThemeColorSlot, ThemeColorValue> & {
  avatar: NovaAvatarTheme;
  background: ThemeColorValue;
  backgroundEffect: FluidBackgroundSettings;
  border: ThemeBorderValue;
  clockColor: ThemeColorValue;
  clockFont: ThemeFontSetting;
  controlSound: ControlSoundSettings;
  desktopWallpaper: DesktopWallpaperSettings;
  font: ThemeFontSetting;
  gymFont: ThemeFontSetting;
  map: Record<MapThemeColorSlot, ThemeColorValue>;
  mapBuildingOpacity: number;
  mapLabelSize: number;
  mapSatellite: boolean;
  mapWater: ThemeMapLayerValue;
  radarOpacity: number;
  radarPaletteMode: RadarPaletteMode;
  taskGlowIntensity: number;
  titleColors: ThemeTitleColors;
  titleTone: ThemeTitleTone;
  transcriptFont: ThemeFontSetting;
  voiceTranscriptColors: ThemeVoiceTranscriptColors;
};

export type DeviceThemeSet = {
  selection: ThemeSelection;
  themes: Record<ThemeVariant, DeviceTheme>;
};

export type SunThemeStatus = {
  nextRising?: string | null;
  nextSetting?: string | null;
  state?: string | null;
};

export type ThemeStorageValue =
  | {
      selection?: ThemeSelection;
      themes?: Partial<Record<ThemeVariant, Partial<DeviceTheme & ThemeColorValue> | null>>;
    }
  | Partial<DeviceTheme & ThemeColorValue>;

export type ThemeSource = "initial-prop" | "shared-cache" | "local-storage" | "api-theme" | "event" | "set" | "default";

type StoredMapTheme = Partial<Record<MapThemeColorSlot, Partial<ThemeColorValue>>> & {
  buildings?: Partial<ThemeColorValue>;
  majorRoads?: Partial<ThemeColorValue>;
  minorRoads?: Partial<ThemeColorValue>;
};

const THEME_STORAGE_KEY = "nova.dashboard.accent.v1";
const SHARED_THEME_STORAGE_KEY = "nova.dashboard.sharedAccent.v1";
const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
const THEME_SCOPE_STORAGE_KEY = "nova.dashboard.configScope.v1";
const THEME_SCOPE_COOKIE_NAME = "nova.dashboard.configScope.v1";
const THEME_CHANGE_EVENT = "nova-accent-change";
const THEME_SCOPE_CHANGE_EVENT = "nova-config-scope-change";
const SUN_CHANGE_EVENT = "nova-sun-change";
export const NOVA_THEME_SET_CHANGE_EVENT = "nova-theme-set-change";
const DEFAULT_THEME_SCOPE: ThemeConfigScope = "shared";
const DEFAULT_THEME_SELECTION: ThemeSelection = "auto";
const SHARED_THEME_POLL_MS = 30 * 1000;
const SHARED_THEME_WRITE_DEBOUNCE_MS = 250;
const SHARED_THEME_WRITE_RETRY_MS = 1000;

// After the user edits a theme value (e.g. dragging a colour spectrum or an
// intensity/opacity slider) we hold off the background shared-theme refresh for
// this long. The 30s poll fetches /api/theme over the network, and until the
// debounced write below has landed that response still carries the pre-edit
// colour — applying it mid-drag snapped the swatch back (the "colour"
// rubber-band). Six seconds comfortably covers the debounced write plus the
// server round-trip, matching the config-side useSettingCooldown contract.
function pauseThemePolling() {
  markControlInteraction();
}
function isThemePollingPaused() {
  return isControlInteractionCoolingDown();
}
export const THEME_SELECTIONS: ThemeSelection[] = ["dark", "light", "auto"];
export const THEME_VARIANTS: ThemeVariant[] = ["dark", "light"];
export const RADAR_OPACITY_DEFAULT = 87;
export const RADAR_OPACITY_MAX = 100;
export const RADAR_OPACITY_MIN = 0;
export const MAP_LABEL_SIZE_DEFAULT = 150;
export const MAP_LABEL_SIZE_MAX = 200;
export const MAP_LABEL_SIZE_MIN = 50;
export const MAP_BUILDING_OPACITY_DEFAULT = 66;
export const MAP_BUILDING_OPACITY_MAX = 100;
export const MAP_BUILDING_OPACITY_MIN = 0;
export const TASK_GLOW_INTENSITY_DEFAULT = 100;
export const TASK_GLOW_INTENSITY_MAX = 300;
export const TASK_GLOW_INTENSITY_MIN = 50;
export const FLUID_BACKGROUND_APEX_GLOW_DEFAULT = 55;
export const FLUID_BACKGROUND_APEX_GLOW_MAX = 240;
export const FLUID_BACKGROUND_APEX_GLOW_MIN = 0;
export const FLUID_BACKGROUND_FALLOFF_POWER_DEFAULT = 125;
export const FLUID_BACKGROUND_FALLOFF_POWER_MAX = 320;
export const FLUID_BACKGROUND_FALLOFF_POWER_MIN = 80;
export const FLUID_BACKGROUND_HUE_SPREAD_DEFAULT = 100;
export const FLUID_BACKGROUND_HUE_SPREAD_MAX = 100;
export const FLUID_BACKGROUND_HUE_SPREAD_MIN = 0;
export const FLUID_BACKGROUND_PEAK_INTENSITY_DEFAULT = 60;
export const FLUID_BACKGROUND_PEAK_INTENSITY_MAX = 260;
export const FLUID_BACKGROUND_PEAK_INTENSITY_MIN = 40;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_DEFAULT = 120;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_MAX = 220;
export const FLUID_BACKGROUND_WARP_AMPLITUDE_MIN = 40;
export const FLUID_BACKGROUND_TEXTURE_SCALE_DEFAULT = 100;
export const FLUID_BACKGROUND_TEXTURE_SCALE_MAX = 500;
export const FLUID_BACKGROUND_TEXTURE_SCALE_MIN = 25;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT = 45;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_MAX = 100;
export const VOICE_TRANSCRIPT_GLOW_INTENSITY_MIN = 0;
export const VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT = 8;
export const VOICE_TRANSCRIPT_GLOW_SIZE_MAX = 32;
export const VOICE_TRANSCRIPT_GLOW_SIZE_MIN = 0;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT = 18;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_MAX = 100;
export const VOICE_TRANSCRIPT_SCANLINE_OPACITY_MIN = 0;
// Percentage scale of the scanline pitch (100 = 1px line / 3px period).
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT = 100;
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_MAX = 300;
export const VOICE_TRANSCRIPT_SCANLINE_SCALE_MIN = 50;
export const CONTROL_SOUND_VOLUME_DEFAULT = 60;
export const CONTROL_SOUND_VOLUME_MAX = 100;
export const CONTROL_SOUND_VOLUME_MIN = 0;
// Uploaded UI sounds are embedded as data URLs inside the theme, so cap the raw
// file to keep the theme/preset JSON sane. ~1 MB is plenty for any UI click.
export const CONTROL_SOUND_FILE_MAX_BYTES = 1_000_000;
// base64 inflates by ~4/3, plus the "data:audio/...;base64," prefix.
const CONTROL_SOUND_SOURCE_MAX_LENGTH = Math.ceil(CONTROL_SOUND_FILE_MAX_BYTES * 1.4) + 64;
export const DEFAULT_CONTROL_SOUND: ControlSoundSettings = {
  name: null,
  source: null,
  volume: CONTROL_SOUND_VOLUME_DEFAULT,
};

const NOVA_DEFAULT_BACKGROUND_TEXTURE_URL = "/nova-background-texture.png";

const DEFAULT_DARK_THEME: DeviceTheme = {
  accent: {
    cursor: { x: 0.14599810757852905, y: 0.2453125544956752 },
    intensity: 20,
    rgb: [231, 211, 85],
  },
  highlight: {
    cursor: { x: 0.13315222820151282, y: 0 },
    intensity: 30,
    rgb: [255, 204, 0],
  },
  avatar: {
    gradientAlert: {
      cursor: { x: 0.15884383617700407, y: 0 },
      intensity: 100,
      rgb: [255, 242, 0],
    },
    gradientCenter: {
      cursor: { x: 0.14500990501931962, y: 0.04888316563197544 },
      intensity: 56,
      rgb: [249, 218, 16],
    },
    gradientOuter: {
      cursor: { x: 0.134140279982181, y: 0 },
      intensity: 20,
      rgb: [255, 204, 0],
    },
    gymAlertThresholdHours: 46,
    gymNumberColor: {
      cursor: { x: 0.9504734424661913, y: 0 },
      intensity: 100,
      rgb: [255, 0, 81],
    },
    gymNumberOpacity: 100,
    voiceGlowColor: {
      cursor: { x: 0.53, y: 0 },
      intensity: 100,
      rgb: [60, 220, 240],
    },
    lineColors: [
      {
        cursor: { x: 0.1282115169625482, y: 0 },
        intensity: 26,
        rgb: [255, 196, 0],
      },
      {
        cursor: { x: 0.14698615935919723, y: 0 },
        intensity: 31,
        rgb: [255, 225, 0],
      },
      {
        cursor: { x: 0.11734189192540956, y: 0 },
        intensity: 29,
        rgb: [255, 179, 0],
      },
    ],
    lineOpacities: [25, 30, 27],
    innerShadowOpacity: 0.5,
    orbModule: "classic",
    orbModuleSettings: {},
    glass: DEFAULT_NOVA_GLASS_SETTINGS,
  },
  background: {
    cursor: { x: 0.12327065494504236, y: 0.3238836015973772 },
    intensity: 15,
    rgb: [227, 196, 109],
  },
  backgroundEffect: {
    apexGlow: 110,
    falloffPower: 320,
    hueSpread: 100,
    peakIntensity: 260,
    textureScale: 204,
    textureUrl: NOVA_DEFAULT_BACKGROUND_TEXTURE_URL,
    warpAmplitude: 220,
  },
  desktopWallpaper: {
    landscapeAssetId: null,
    portraitAssetId: null,
  },
  border: {
    color: {
      cursor: { x: 0.1291995687432164, y: 0 },
      intensity: 100,
      rgb: [255, 196, 0],
    },
    enabled: true,
    opacity: 15,
  },
  clockColor: {
    cursor: { x: 0.12228260316437417, y: 0.4738834926060268 },
    intensity: 87,
    rgb: [224, 205, 154],
  },
  clockFont: { ...DEFAULT_CLOCK_FONT_SETTING },
  controlSound: { ...DEFAULT_CONTROL_SOUND },
  font: { ...DEFAULT_DISPLAY_FONT_SETTING },
  gymFont: { ...DEFAULT_GYM_FONT_SETTING },
  transcriptFont: { ...DEFAULT_TRANSCRIPT_FONT_SETTING },
  map: {
    base: {
      cursor: { x: 0.7555470052584329, y: 1 },
      intensity: 10,
      rgb: [255, 255, 255],
    },
    water: {
      cursor: { x: 0.7593946389637041, y: 0 },
      intensity: 100,
      rgb: [140, 0, 255],
    },
    land: {
      cursor: { x: 0.55, y: 0.94 },
      intensity: 14,
      rgb: [217, 229, 229],
    },
    buildingLow: {
      cursor: { x: 0.7427215595741953, y: 0 },
      intensity: 63,
      rgb: [115, 0, 255],
    },
    buildingHigh: {
      cursor: { x: 0.7433628318584072, y: 0 },
      intensity: 100,
      rgb: [115, 0, 255],
    },
    roads: {
      cursor: { x: 0.7247659356162627, y: 0.4790372670807455 },
      intensity: 100,
      rgb: [177, 154, 223],
    },
    labels: {
      cursor: { x: 0.7305373861741696, y: 1 },
      intensity: 66,
      rgb: [255, 255, 255],
    },
    radarLow: {
      cursor: { x: 0.1598050532255996, y: 0 },
      intensity: 100,
      rgb: [255, 242, 0],
    },
    radarHigh: {
      cursor: { x: 0.2643324355521355, y: 0 },
      intensity: 100,
      rgb: [106, 255, 0],
    },
  },
  mapBuildingOpacity: 66,
  mapLabelSize: 150,
  mapSatellite: true,
  mapWater: {
    enabled: true,
    opacity: 10,
  },
  radarOpacity: 87,
  radarPaletteMode: "custom",
  taskGlowIntensity: 100,
  titleColors: {
    dark: {
      cursor: { x: 0.12524706006346117, y: 0.08816964285714286 },
      intensity: 13,
      rgb: [244, 191, 31],
    },
    light: {
      cursor: { x: 0.12228260316437417, y: 0.4738834926060268 },
      intensity: 87,
      rgb: [224, 205, 154],
    },
  },
  titleTone: "auto",
  voiceTranscriptColors: {
    background: {
      cursor: { x: 0.12327065494504236, y: 0.3238836015973772 },
      intensity: 15,
      rgb: [227, 196, 109],
    },
    glowIntensity: VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT,
    glowSize: VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT,
    scanlineOpacity: VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT,
    scanlineScale: VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT,
    text: {
      cursor: { x: 0.12228260316437417, y: 0.4738834926060268 },
      intensity: 87,
      rgb: [224, 205, 154],
    },
  },
};

const DEFAULT_LIGHT_THEME: DeviceTheme = {
  accent: {
    cursor: { x: 0.14303365067944204, y: 0.2453125544956752 },
    intensity: 37,
    rgb: [231, 209, 85],
  },
  highlight: {
    cursor: { x: 0.12129455138370598, y: 0.11674063546316964 },
    intensity: 63,
    rgb: [242, 189, 44],
  },
  avatar: {
    gradientAlert: {
      cursor: { x: 0.15785578439633588, y: 0.2943077087402344 },
      intensity: 73,
      rgb: [229, 223, 102],
    },
    gradientCenter: {
      cursor: { x: 0.12524706006346117, y: 0.10145078386579241 },
      intensity: 74,
      rgb: [244, 192, 37],
    },
    gradientOuter: {
      cursor: { x: 0.11536548680699073, y: 0.1300217764718192 },
      intensity: 5,
      rgb: [241, 180, 50],
    },
    gymAlertThresholdHours: 46,
    gymNumberColor: {
      cursor: { x: 0.9504734424661913, y: 0 },
      intensity: 100,
      rgb: [255, 0, 81],
    },
    gymNumberOpacity: 100,
    voiceGlowColor: {
      cursor: { x: 0.53, y: 0 },
      intensity: 100,
      rgb: [60, 220, 240],
    },
    lineColors: [
      {
        cursor: { x: 0.11437743502632254, y: 0 },
        intensity: 17,
        rgb: [255, 174, 0],
      },
      {
        cursor: { x: 0.12425885750425177, y: 0.02645056588309152 },
        intensity: 25,
        rgb: [251, 191, 9],
      },
      {
        cursor: { x: 0.08572137015174427, y: 0 },
        intensity: 23,
        rgb: [255, 132, 0],
      },
    ],
    lineOpacities: [17, 23, 23],
    innerShadowOpacity: 0.5,
    orbModule: "classic",
    orbModuleSettings: {},
    glass: DEFAULT_NOVA_GLASS_SETTINGS,
  },
  background: {
    cursor: { x: 0.1351284825413904, y: 0.3667411804199219 },
    intensity: 34,
    rgb: [225, 206, 122],
  },
  backgroundEffect: {
    apexGlow: 240,
    falloffPower: 320,
    hueSpread: 100,
    peakIntensity: 260,
    textureScale: 99,
    textureUrl: NOVA_DEFAULT_BACKGROUND_TEXTURE_URL,
    warpAmplitude: 220,
  },
  desktopWallpaper: {
    landscapeAssetId: null,
    portraitAssetId: null,
  },
  border: {
    color: {
      cursor: { x: 0.13611668510059982, y: 0 },
      intensity: 100,
      rgb: [255, 208, 0],
    },
    enabled: true,
    opacity: 19,
  },
  clockColor: {
    cursor: { x: 0.7818660545503647, y: 0 },
    intensity: 0,
    rgb: [174, 0, 255],
  },
  clockFont: { ...DEFAULT_CLOCK_FONT_SETTING },
  controlSound: { ...DEFAULT_CONTROL_SOUND },
  font: { ...DEFAULT_DISPLAY_FONT_SETTING },
  gymFont: { ...DEFAULT_GYM_FONT_SETTING },
  transcriptFont: { ...DEFAULT_TRANSCRIPT_FONT_SETTING },
  map: {
    base: {
      cursor: { x: 0.7555470052584329, y: 1 },
      intensity: 10,
      rgb: [255, 255, 255],
    },
    water: {
      cursor: { x: 0.7593946389637041, y: 0 },
      intensity: 100,
      rgb: [140, 0, 255],
    },
    land: {
      cursor: { x: 0.55, y: 0.94 },
      intensity: 14,
      rgb: [217, 229, 229],
    },
    buildingLow: {
      cursor: { x: 0.7427215595741953, y: 0 },
      intensity: 63,
      rgb: [115, 0, 255],
    },
    buildingHigh: {
      cursor: { x: 0.7433628318584072, y: 0 },
      intensity: 100,
      rgb: [115, 0, 255],
    },
    roads: {
      cursor: { x: 0.7247659356162627, y: 0.4790372670807455 },
      intensity: 100,
      rgb: [177, 154, 223],
    },
    labels: {
      cursor: { x: 0.7305373861741696, y: 1 },
      intensity: 66,
      rgb: [255, 255, 255],
    },
    radarLow: {
      cursor: { x: 0.1598050532255996, y: 0 },
      intensity: 100,
      rgb: [255, 242, 0],
    },
    radarHigh: {
      cursor: { x: 0.2643324355521355, y: 0 },
      intensity: 100,
      rgb: [106, 255, 0],
    },
  },
  mapBuildingOpacity: 66,
  mapLabelSize: 150,
  mapSatellite: true,
  mapWater: {
    enabled: true,
    opacity: 10,
  },
  radarOpacity: 87,
  radarPaletteMode: "custom",
  taskGlowIntensity: 100,
  titleColors: {
    dark: {
      cursor: { x: 0.7818660545503647, y: 0 },
      intensity: 0,
      rgb: [174, 0, 255],
    },
    light: {
      cursor: { x: 0.17564237501231672, y: 0.7453125544956752 },
      intensity: 93,
      rgb: [229, 230, 214],
    },
  },
  titleTone: "auto",
  voiceTranscriptColors: {
    background: {
      cursor: { x: 0.1351284825413904, y: 0.3667411804199219 },
      intensity: 34,
      rgb: [225, 206, 122],
    },
    glowIntensity: VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT,
    glowSize: VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT,
    scanlineOpacity: VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT,
    scanlineScale: VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT,
    text: {
      cursor: { x: 0.17564237501231672, y: 0.7453125544956752 },
      intensity: 93,
      rgb: [229, 230, 214],
    },
  },
};

export const DEFAULT_THEME: DeviceTheme = DEFAULT_DARK_THEME;

export const DEFAULT_THEME_SET: DeviceThemeSet = {
  selection: DEFAULT_THEME_SELECTION,
  themes: {
    dark: DEFAULT_DARK_THEME,
    light: DEFAULT_LIGHT_THEME,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const s = saturation / 100;
  const l = lightness / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function normalizeColor(value: Partial<ThemeColorValue> | null | undefined, fallback: ThemeColorValue): ThemeColorValue {
  const rgb = Array.isArray(value?.rgb) && value.rgb.length >= 3
    ? value.rgb.slice(0, 3).map((part) => clamp(Math.round(Number(part)), 0, 255)) as [number, number, number]
    : fallback.rgb;
  const cursor = {
    x: clamp(Number(value?.cursor?.x ?? fallback.cursor.x), 0, 1),
    y: clamp(Number(value?.cursor?.y ?? fallback.cursor.y), 0, 1),
  };
  const intensity = clamp(Math.round(Number(value?.intensity ?? fallback.intensity)), 0, 100);

  return { cursor, intensity, rgb };
}

function normalizeRadarPaletteMode(value: unknown): RadarPaletteMode {
  return value === "spectrum" ? "spectrum" : "custom";
}

function normalizeThemeScope(value: unknown): ThemeConfigScope {
  if (value === "local") {
    return "local";
  }
  if (value === "shared") {
    return "shared";
  }
  return DEFAULT_THEME_SCOPE;
}

function normalizeThemeSelection(value: unknown): ThemeSelection {
  if (value === "auto" || value === "dark" || value === "light") {
    return value;
  }
  return DEFAULT_THEME_SELECTION;
}

function normalizeThemeVariant(value: unknown): ThemeVariant {
  return value === "light" ? "light" : "dark";
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(Math.round(parsed), min, max);
}

function normalizePercent(value: unknown, fallback: number) {
  return normalizeNumber(value, fallback, 0, 100);
}

function normalizeMapLabelSize(value: unknown) {
  return normalizeNumber(value, MAP_LABEL_SIZE_DEFAULT, MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX);
}

function normalizeMapBuildingOpacity(value: unknown) {
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
    landscapeAssetId: normalizeWallpaperAssetId(value?.landscapeAssetId),
    portraitAssetId: normalizeWallpaperAssetId(value?.portraitAssetId),
  };
}

export function normalizeControlSoundSource(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("data:audio/") || trimmed.length > CONTROL_SOUND_SOURCE_MAX_LENGTH) {
    return null;
  }

  return trimmed;
}

export function normalizeControlSound(value: Partial<ControlSoundSettings> | null | undefined): ControlSoundSettings {
  const source = normalizeControlSoundSource(value?.source);
  const name = source && typeof value?.name === "string" && value.name.trim()
    ? value.name.trim().slice(0, 120)
    : null;

  return {
    name,
    source,
    volume: normalizeNumber(value?.volume, DEFAULT_CONTROL_SOUND.volume, CONTROL_SOUND_VOLUME_MIN, CONTROL_SOUND_VOLUME_MAX),
  };
}

function normalizeThemeAvatar(value: unknown) {
  const avatar = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<NovaAvatarTheme>
    : null;

  return normalizeNovaAvatarTheme(avatar ?? DEFAULT_THEME.avatar);
}

function matchesThemeColor(value: Partial<ThemeColorValue> | null | undefined, expected: ThemeColorValue) {
  if (!value) {
    return false;
  }

  const normalized = normalizeColor(value, expected);
  return normalized.intensity === expected.intensity
    && normalized.rgb.every((part, index) => part === expected.rgb[index]);
}

function normalizeTheme(value: Partial<DeviceTheme & ThemeColorValue> | null | undefined): DeviceTheme {
  const storedAccent = value?.accent ?? (Array.isArray(value?.rgb) ? value : null);
  const titleTone = ["auto", "light", "dark"].includes(String(value?.titleTone))
    ? (value?.titleTone as ThemeTitleTone)
    : DEFAULT_THEME.titleTone;
  const borderValue = value?.border;
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
    desktopWallpaper: normalizeDesktopWallpaperSettings(value?.desktopWallpaper),
    font: normalizeThemeFontSetting(value?.font, DEFAULT_THEME_FONT_ID, DEFAULT_DISPLAY_FONT_SETTING.weight),
    gymFont: normalizeThemeFontSetting(value?.gymFont, DEFAULT_THEME_FONT_ID, DEFAULT_GYM_FONT_SETTING.weight),
    transcriptFont: normalizeThemeFontSetting(value?.transcriptFont, DEFAULT_THEME_FONT_ID, DEFAULT_TRANSCRIPT_FONT_SETTING.weight),
    border: {
      color: normalizeColor(borderValue?.color, DEFAULT_THEME.border.color),
      enabled: borderValue?.enabled === undefined ? DEFAULT_THEME.border.enabled : borderValue.enabled === true,
      opacity: clamp(Math.round(Number(borderValue?.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
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
    mapBuildingOpacity: normalizeMapBuildingOpacity(value?.mapBuildingOpacity),
    mapLabelSize: normalizeMapLabelSize(value?.mapLabelSize),
    mapSatellite: value?.mapSatellite !== false,
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

function sunStatusIsDark(sun?: SunThemeStatus | null) {
  if (sun?.state === "below_horizon") {
    return true;
  }
  if (sun?.state === "above_horizon") {
    return false;
  }

  const nextRising = Date.parse(String(sun?.nextRising ?? ""));
  const nextSetting = Date.parse(String(sun?.nextSetting ?? ""));
  if (Number.isFinite(nextRising) && Number.isFinite(nextSetting)) {
    return nextRising < nextSetting;
  }

  const hour = new Date().getHours();
  return hour < 6 || hour >= 18;
}

export function resolveThemeVariant(selection: ThemeSelection, sun?: SunThemeStatus | null): ThemeVariant {
  if (selection === "dark" || selection === "light") {
    return selection;
  }
  return sunStatusIsDark(sun) ? "dark" : "light";
}

export function resolveDeviceTheme(themeSet: DeviceThemeSet, sun?: SunThemeStatus | null) {
  const normalized = normalizeThemeSet(themeSet);
  const activeVariant = resolveThemeVariant(normalized.selection, sun);
  return {
    activeVariant,
    theme: normalized.themes[activeVariant],
  };
}

export function themeRgbAtPosition(x: number, y: number): [number, number, number] {
  const hue = Math.round(clamp(x, 0, 1) * 359);
  const boundedY = clamp(y, 0, 1);
  const saturation = Math.round((1 - boundedY) * 100);
  const lightness = Math.round(50 + boundedY * 50);

  return hslToRgb(hue, saturation, lightness);
}

export function appliedThemeRgb(color: ThemeColorValue): [number, number, number] {
  const normalized = normalizeColor(color, DEFAULT_THEME.accent);
  const ratio = normalized.intensity / 100;

  return normalized.rgb.map((value) => clamp(Math.round(value * ratio), 0, 255)) as [number, number, number];
}

function applyCssColor(name: "line" | "cyan", rgb: [number, number, number]) {
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  if (name === "line") {
    root.style.setProperty("--foreground", `rgb(${value})`);
    root.style.setProperty("--cyber-line", `rgb(${value})`);
    root.style.setProperty("--cyber-line-rgb", value);
    root.style.setProperty("--cyber-line-dim", `rgb(${value} / 0.36)`);
    return;
  }

  root.style.setProperty("--cyber-cyan", `rgb(${value})`);
  root.style.setProperty("--cyber-cyan-rgb", value);
  root.style.setProperty("--cyber-highlight", `rgb(${value})`);
  root.style.setProperty("--cyber-highlight-rgb", value);
}

function applyCssBorder(border: ThemeBorderValue, fallbackRgb: [number, number, number]) {
  const normalizedBorder = {
    color: normalizeColor(border.color, DEFAULT_THEME.border.color),
    enabled: border.enabled === true,
    opacity: clamp(Math.round(Number(border.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
  };
  const rgb = normalizedBorder.enabled ? appliedThemeRgb(normalizedBorder.color) : fallbackRgb;
  const opacity = normalizedBorder.enabled ? normalizedBorder.opacity / 100 : 0.36;
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  root.style.setProperty("--cyber-border-rgb", value);
  root.style.setProperty("--cyber-border-dim", `rgb(${value} / ${opacity})`);
  root.style.setProperty("--cyber-border-strong", `rgb(${value} / ${Math.min(1, opacity + 0.54)})`);
}

function mixRgb(from: [number, number, number], to: [number, number, number], amount: number): [number, number, number] {
  return [
    clamp(Math.round(from[0] + (to[0] - from[0]) * amount), 0, 255),
    clamp(Math.round(from[1] + (to[1] - from[1]) * amount), 0, 255),
    clamp(Math.round(from[2] + (to[2] - from[2]) * amount), 0, 255),
  ];
}

function rgbCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function applyCssBackground(rgb: [number, number, number]) {
  const root = document.documentElement;
  root.style.setProperty("--background", rgbCss(rgb));
  root.style.setProperty("--cyber-bg", rgbCss(rgb));
  root.style.setProperty("--cyber-panel", rgbCss(mixRgb(rgb, [0, 0, 0], 0.16)));
  root.style.setProperty("--cyber-panel-soft", rgbCss(mixRgb(rgb, [255, 255, 255], 0.07)));
}

function applyCssVoiceTranscript(colors: ThemeVoiceTranscriptColors) {
  const root = document.documentElement;
  const background = appliedThemeRgb(colors.background);
  const text = appliedThemeRgb(colors.text);
  root.style.setProperty("--cyber-voice-transcript-bg", rgbCss(background));
  root.style.setProperty("--cyber-voice-transcript-text", rgbCss(text));
  root.style.setProperty("--cyber-voice-transcript-text-rgb", `${text[0]} ${text[1]} ${text[2]}`);
  // The scanline tint uses the raw selected hue (not intensity-scaled) so the
  // texture stays visible over a very dark applied background.
  const tint = colors.background.rgb;
  root.style.setProperty("--cyber-voice-transcript-scanline-rgb", `${tint[0]} ${tint[1]} ${tint[2]}`);
  root.style.setProperty("--cyber-voice-transcript-scanline-opacity", (colors.scanlineOpacity / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-scanline-scale", (colors.scanlineScale / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-glow-alpha", (colors.glowIntensity / 100).toFixed(3));
  root.style.setProperty("--cyber-voice-transcript-glow-size", `${colors.glowSize}px`);
}

function luminance(rgb: [number, number, number]) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

type ThemeTitleColorSlot = keyof ThemeTitleColors;

function titleColorSlotFor(tone: ThemeTitleTone, rgb: [number, number, number], allowOverride: boolean): ThemeTitleColorSlot {
  if (!allowOverride) {
    return luminance(rgb) > 0.5 ? "dark" : "light";
  }
  if (tone === "dark") {
    return "dark";
  }
  if (tone === "light") {
    return "light";
  }

  return luminance(rgb) > 0.5 ? "dark" : "light";
}

function titleColorFor(tone: ThemeTitleTone, rgb: [number, number, number], allowOverride: boolean) {
  return `var(--cyber-title-${titleColorSlotFor(tone, rgb, allowOverride)})`;
}

function applyCssTitleColors(colors: ThemeTitleColors) {
  const root = document.documentElement;
  const dark = appliedThemeRgb(colors.dark);
  const light = appliedThemeRgb(colors.light);

  root.style.setProperty("--cyber-title-dark", rgbCss(dark));
  root.style.setProperty("--cyber-title-light", rgbCss(light));
}

function applyCssTitleTone(
  tone: ThemeTitleTone,
  accent: [number, number, number],
  highlight: [number, number, number],
  background: [number, number, number],
  clockColor: ThemeColorValue,
  titleColors: ThemeTitleColors,
) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-title-on-line", titleColorFor(tone, accent, false));
  root.style.setProperty("--cyber-title-on-cyan", titleColorFor(tone, highlight, false));
  root.style.setProperty("--cyber-title-on-highlight", titleColorFor(tone, highlight, false));
  const clockTextFill = titleColorFor(tone, background, true);
  root.style.setProperty("--cyber-title-on-bg", clockTextFill);
  root.style.setProperty("--cyber-clock-text-fill", clockTextFill);
  root.style.setProperty("--cyber-clock-color", rgbCss(appliedThemeRgb(clockColor)));

  const titleColorSlot = titleColorSlotFor(tone, background, true);
  const clockFill = appliedThemeRgb(titleColors[titleColorSlot]);
  root.style.setProperty("--cyber-title-on-clock-fill", titleColorFor("auto", clockFill, false));
}

function applyCssMap(map: DeviceTheme["map"]) {
  const root = document.documentElement;
  const setMapColor = (name: string, color: ThemeColorValue) => {
    const rgb = appliedThemeRgb(color);
    const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
    root.style.setProperty(`--cyber-map-${name}`, `rgb(${value})`);
    root.style.setProperty(`--cyber-map-${name}-rgb`, value);
  };

  setMapColor("base", map.base);
  setMapColor("water", map.water);
  setMapColor("land", map.land);
  setMapColor("building-low", map.buildingLow);
  setMapColor("building-high", map.buildingHigh);
  setMapColor("roads", map.roads);
  setMapColor("labels", map.labels);
  setMapColor("radar-low", map.radarLow);
  setMapColor("radar-high", map.radarHigh);
}

function applyCssMapWater(water: ThemeMapLayerValue) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-map-water-enabled", water.enabled ? "1" : "0");
  root.style.setProperty("--cyber-map-water-opacity", String(normalizePercent(water.opacity, DEFAULT_THEME.mapWater.opacity)));
}

function applyCssMapLabelSize(value: number) {
  document.documentElement.style.setProperty("--cyber-map-label-size", String(normalizeMapLabelSize(value)));
}

function applyCssMapBuildingOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-building-opacity", String(normalizeMapBuildingOpacity(value)));
}

function applyCssRadarOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-radar-opacity", String(normalizeRadarOpacity(value)));
}

function applyCssTaskGlowIntensity(value: number) {
  const intensity = normalizeTaskGlowIntensity(value);
  const scale = intensity / 100;
  const root = document.documentElement;

  root.style.setProperty("--task-glow-intensity", String(intensity));
  root.style.setProperty("--task-glow-cyan-blur", `${Math.round(128 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-spread", `${Math.round(42 * scale)}px`);
  root.style.setProperty("--task-glow-line-blur", `${Math.round(72 * scale)}px`);
  root.style.setProperty("--task-glow-line-spread", `${Math.round(18 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-alpha", Math.min(1, 0.7 * scale).toFixed(3));
  root.style.setProperty("--task-glow-line-alpha", Math.min(1, 0.72 * scale).toFixed(3));
}

// Expose the alert colour to CSS.
//
// The avatar theme is a JS/canvas palette (orbModules reads gradientAlert
// straight off the theme object), so nothing in a stylesheet could reach it.
// The reminder icon bar's overdue pulse shouts in the same colour, so it is
// published as a custom property here, the same way NovaAvatar publishes
// --nova-avatar-voice-glow. Space-separated channels so the value works
// inside rgb(... / alpha).
//
// Intensity is deliberately NOT applied the way the orb applies it. On the orb
// slot, intensity 0 means "do not tint the orb" — a perfectly reasonable thing
// to want, and the shipped dark theme ships exactly that. Scaling by it here
// would multiply the colour to black and turn the overdue pulse into an
// invisible glow: the feature would silently do nothing on a default install.
// So take the intensity-applied colour when it renders to something, and fall
// back to the slot's chosen HUE otherwise. The user's colour choice is still
// honoured; only "how hard to tint the orb" is ignored, because that question
// is not being asked here.
// Last-resort overdue colour: amber, matching the shipped gradientAlert hue.
const DEFAULT_ALERT_RGB: [number, number, number] = [250, 168, 15];

function applyCssAlertColor(value: ThemeColorValue) {
  const applied = appliedThemeRgb(value);
  const hue = normalizeColor(value, DEFAULT_THEME.accent).rgb;
  const visible = (rgb: readonly number[]) => rgb.some((channel) => channel > 8);

  const [r, g, b] = visible(applied)
    ? applied
    : visible(hue)
      ? hue
      : DEFAULT_ALERT_RGB;

  document.documentElement.style.setProperty("--nova-alert-rgb", `${r} ${g} ${b}`);
}

// Seed the family/weight/size-scale CSS vars for one font slot. The element rules in
// globals.css read --cyber-<slot>, --cyber-<slot>-weight and --cyber-<slot>-scale.
function applyThemeFontVars(slot: "display" | "clock" | "gym" | "transcript", setting: ThemeFontSetting) {
  const style = document.documentElement.style;
  style.setProperty(`--cyber-${slot}`, themeFontStack(setting.id));
  style.setProperty(`--cyber-${slot}-weight`, String(setting.weight));
  style.setProperty(`--cyber-${slot}-scale`, String(themeFontSizeScale(setting.sizeOffset)));
}

export function applyDeviceTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  const accent = appliedThemeRgb(normalized.accent);
  const highlight = appliedThemeRgb(normalized.highlight);
  const background = appliedThemeRgb(normalized.background);

  applyCssColor("line", accent);
  applyCssColor("cyan", highlight);
  applyCssBorder(normalized.border, accent);
  applyCssBackground(background);
  applyCssTitleColors(normalized.titleColors);
  applyCssTitleTone(normalized.titleTone, accent, highlight, background, normalized.clockColor, normalized.titleColors);
  applyCssVoiceTranscript(normalized.voiceTranscriptColors);
  applyCssMap(normalized.map);
  applyCssMapBuildingOpacity(normalized.mapBuildingOpacity);
  applyCssMapLabelSize(normalized.mapLabelSize);
  applyCssMapWater(normalized.mapWater);
  applyCssRadarOpacity(normalized.radarOpacity);
  applyCssTaskGlowIntensity(normalized.taskGlowIntensity);
  applyCssAlertColor(normalized.avatar.gradientAlert);
  setActiveControlSound(normalized.controlSound);
  applyThemeFontVars("display", normalized.font);
  applyThemeFontVars("clock", normalized.clockFont);
  applyThemeFontVars("gym", normalized.gymFont);
  applyThemeFontVars("transcript", normalized.transcriptFont);
  document.documentElement.style.setProperty("--cyber-map-radar-mode", normalized.radarPaletteMode);
  document.documentElement.style.setProperty("--cyber-map-satellite", normalized.mapSatellite ? "1" : "0");
}

function mixedThemeColor(from: ThemeColorValue, to: ThemeColorValue, amount: number): ThemeColorValue {
  const blend = clamp(amount, 0, 1);
  return {
    cursor: {
      x: from.cursor.x + (to.cursor.x - from.cursor.x) * blend,
      y: from.cursor.y + (to.cursor.y - from.cursor.y) * blend,
    },
    intensity: from.intensity + (to.intensity - from.intensity) * blend,
    rgb: from.rgb.map((part, index) =>
      Math.round(part + (to.rgb[index] - part) * blend),
    ) as [number, number, number],
  };
}

/** Blend every colour-bearing field while retaining all dashboard behavior,
 * typography, sizing, opacity, effects, and module choices from `configured`. */
export function mixDeviceThemeColors(configured: DeviceTheme, target: DeviceTheme, amount: number): DeviceTheme {
  const color = (from: ThemeColorValue, to: ThemeColorValue) => mixedThemeColor(from, to, amount);
  return {
    ...configured,
    accent: color(configured.accent, target.accent),
    highlight: color(configured.highlight, target.highlight),
    background: color(configured.background, target.background),
    border: { ...configured.border, color: color(configured.border.color, target.border.color) },
    clockColor: color(configured.clockColor, target.clockColor),
    titleColors: {
      dark: color(configured.titleColors.dark, target.titleColors.dark),
      light: color(configured.titleColors.light, target.titleColors.light),
    },
    voiceTranscriptColors: {
      ...configured.voiceTranscriptColors,
      background: color(configured.voiceTranscriptColors.background, target.voiceTranscriptColors.background),
      text: color(configured.voiceTranscriptColors.text, target.voiceTranscriptColors.text),
    },
    map: {
      base: color(configured.map.base, target.map.base),
      water: color(configured.map.water, target.map.water),
      land: color(configured.map.land, target.map.land),
      buildingLow: color(configured.map.buildingLow, target.map.buildingLow),
      buildingHigh: color(configured.map.buildingHigh, target.map.buildingHigh),
      roads: color(configured.map.roads, target.map.roads),
      labels: color(configured.map.labels, target.map.labels),
      radarLow: color(configured.map.radarLow, target.map.radarLow),
      radarHigh: color(configured.map.radarHigh, target.map.radarHigh),
    },
    avatar: {
      ...configured.avatar,
      gradientAlert: color(configured.avatar.gradientAlert, target.avatar.gradientAlert),
      gradientCenter: color(configured.avatar.gradientCenter, target.avatar.gradientCenter),
      gradientOuter: color(configured.avatar.gradientOuter, target.avatar.gradientOuter),
      gymNumberColor: color(configured.avatar.gymNumberColor, target.avatar.gymNumberColor),
      voiceGlowColor: color(configured.avatar.voiceGlowColor, target.avatar.voiceGlowColor),
      lineColors: configured.avatar.lineColors.map((value, index) =>
        color(value, target.avatar.lineColors[index]),
      ) as typeof configured.avatar.lineColors,
    },
  };
}

// While the theme config editor is open it pins :root to the variant being edited
// (the light/dark tab), regardless of the active selection. Without this, the
// shared-theme poll and sun-change events inside useDeviceTheme keep re-applying
// the *selection-resolved* variant to the document, fighting the editor — which is
// what made panel backgrounds, title colours, etc. flicker between the variant
// being edited and the dashboard's active one. When an override is set, applyThemeSet
// applies it instead of the resolved theme; clearing it restores the active theme.
let documentThemeOverride: DeviceTheme | null = null;
let housePartyThemeOverride: DeviceTheme | null = null;
let lastResolvedDocumentTheme: DeviceTheme | null = null;
const HOUSE_PARTY_THEME_OVERRIDE_EVENT = "nova-house-party-theme-override";

export function setHousePartyThemeOverride(theme: DeviceTheme | null) {
  housePartyThemeOverride = theme ? normalizeTheme(theme) : null;
  const next =
    documentThemeOverride ??
    housePartyThemeOverride ??
    lastResolvedDocumentTheme ??
    resolveDeviceTheme(normalizeThemeSet(DEFAULT_THEME_SET)).theme;
  applyDeviceTheme(next);
  window.dispatchEvent(new CustomEvent(HOUSE_PARTY_THEME_OVERRIDE_EVENT, {
    detail: housePartyThemeOverride,
  }));
}

export function setDocumentThemeOverride(theme: DeviceTheme | null) {
  documentThemeOverride = theme ? normalizeTheme(theme) : null;
  const next =
    documentThemeOverride ??
    housePartyThemeOverride ??
    lastResolvedDocumentTheme ??
    resolveDeviceTheme(normalizeThemeSet(DEFAULT_THEME_SET)).theme;
  applyDeviceTheme(next);
}

function cookieValue(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

function readThemeScope() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME_SCOPE;
  }

  try {
    return normalizeThemeScope(window.localStorage.getItem(THEME_SCOPE_STORAGE_KEY) ?? cookieValue(THEME_SCOPE_COOKIE_NAME));
  } catch {
    return normalizeThemeScope(cookieValue(THEME_SCOPE_COOKIE_NAME));
  }
}

function writeThemeScopeCookie(scope: ThemeConfigScope) {
  window.document.cookie = `${THEME_SCOPE_COOKIE_NAME}=${scope}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function writeThemeScope(scope: ThemeConfigScope) {
  const normalized = normalizeThemeScope(scope);
  window.localStorage.setItem(THEME_SCOPE_STORAGE_KEY, normalized);
  writeThemeScopeCookie(normalized);
}

function readStoredThemeValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const text = window.localStorage.getItem(key);
    return text ? JSON.parse(text) as ThemeStorageValue : null;
  } catch {
    return null;
  }
}

function readLocalThemeSet(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  if (typeof window === "undefined") {
    return normalizeThemeSet(fallback);
  }

  return normalizeThemeSet(readStoredThemeValue(THEME_STORAGE_KEY) ?? fallback, fallback);
}

function hasSharedThemeCache() {
  return readStoredThemeValue(SHARED_THEME_STORAGE_KEY) !== null;
}

function readSharedThemeSetFromStorage(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  return normalizeThemeSet(readStoredThemeValue(SHARED_THEME_STORAGE_KEY) ?? fallback, fallback);
}

async function readSharedThemeSet(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  const response = await fetch("/api/theme", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Shared theme request failed: ${response.status}`);
  }

  const data = await response.json() as { theme?: ThemeStorageValue | null };
  return normalizeThemeSet(data.theme ?? fallback, fallback);
}

async function readSunStatus() {
  const response = await fetch("/api/state", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Sun state request failed: ${response.status}`);
  }

  const data = await response.json() as { sun?: SunThemeStatus | null };
  return data.sun ?? null;
}

function writeThemeCookie(themeSet: DeviceThemeSet) {
  window.document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(normalizeThemeSet(themeSet)))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function removeThemeCookie() {
  window.document.cookie = `${THEME_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function writeLocalTheme(themeSet: DeviceThemeSet) {
  const normalized = normalizeThemeSet(themeSet);
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized));
  writeThemeCookie(normalized);
}

function writeSharedThemeCache(themeSet: DeviceThemeSet) {
  const normalized = normalizeThemeSet(themeSet);
  window.localStorage.setItem(SHARED_THEME_STORAGE_KEY, JSON.stringify(normalized));
}

function sharedThemePayload(themeSet: DeviceThemeSet): Record<string, unknown> {
  const normalized = normalizeThemeSet(themeSet);
  return {
    selection: normalized.selection,
    themes: {
      dark: normalizeTheme(normalized.themes.dark),
      light: normalizeTheme(normalized.themes.light),
    },
  };
}

async function writeSharedTheme(themeSet: DeviceThemeSet): Promise<DeviceThemeSet> {
  const normalized = normalizeThemeSet(themeSet);
  const response = await fetch("/api/theme", {
    body: JSON.stringify({ theme: sharedThemePayload(normalized) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Shared theme update failed: ${response.status}`);
  }

  const data = await response.json() as { theme?: ThemeStorageValue | null };
  return normalizeThemeSet(data.theme ?? sharedThemePayload(normalized), normalized);
}

let pendingSharedThemeWrite: DeviceThemeSet | null = null;
let sharedThemeWriteInFlight = false;
let sharedThemeWriteTimer: number | null = null;
let nextThemeHookInstanceId = 1;

function queueSharedThemeFlush(delay = SHARED_THEME_WRITE_DEBOUNCE_MS) {
  if (typeof window === "undefined") {
    return;
  }

  if (sharedThemeWriteTimer !== null) {
    window.clearTimeout(sharedThemeWriteTimer);
  }

  sharedThemeWriteTimer = window.setTimeout(() => {
    sharedThemeWriteTimer = null;
    flushSharedThemeWrite();
  }, delay);
}

function flushSharedThemeWrite() {
  if (sharedThemeWriteInFlight || !pendingSharedThemeWrite) {
    return;
  }

  const nextThemeSet = pendingSharedThemeWrite;
  pendingSharedThemeWrite = null;
  sharedThemeWriteInFlight = true;
  let retryDelay = SHARED_THEME_WRITE_DEBOUNCE_MS;

  void writeSharedTheme(nextThemeSet)
    .then((persistedThemeSet) => {
      if (!pendingSharedThemeWrite) {
        writeSharedThemeCache(persistedThemeSet);
      }
    })
    .catch((error) => {
      console.error("[nova-dashboard] failed to update shared dashboard theme", error);
      // Never discard the user's newest local choice on a transient write
      // failure. Keep it authoritative, retry it, and extend the poll hold so a
      // 30s GET cannot reapply the older server copy in the meantime.
      pendingSharedThemeWrite ??= nextThemeSet;
      retryDelay = SHARED_THEME_WRITE_RETRY_MS;
      pauseThemePolling();
    })
    .finally(() => {
      sharedThemeWriteInFlight = false;
      if (pendingSharedThemeWrite) {
        queueSharedThemeFlush(retryDelay);
      }
    });
}

function scheduleSharedThemeWrite(themeSet: DeviceThemeSet) {
  pendingSharedThemeWrite = normalizeThemeSet(themeSet);
  queueSharedThemeFlush();
}

function initialThemeState(initialTheme: ThemeStorageValue | null | undefined) {
  const scope = readThemeScope();
  if (initialTheme != null) {
    return {
      ready: true,
      source: "initial-prop" as ThemeSource,
      scope,
      themeSet: normalizeThemeSet(initialTheme),
    };
  }

  if (scope === "shared") {
    const hasCache = hasSharedThemeCache();
    return {
      ready: hasCache,
      source: hasCache ? "shared-cache" as ThemeSource : "default" as ThemeSource,
      scope,
      themeSet: readSharedThemeSetFromStorage(DEFAULT_THEME_SET),
    };
  }

  return {
    ready: true,
    source: "local-storage" as ThemeSource,
    scope,
    themeSet: readLocalThemeSet(DEFAULT_THEME_SET),
  };
}

export function useDeviceTheme(initialTheme?: ThemeStorageValue | null, initialSun?: SunThemeStatus | null) {
  const instanceIdRef = useRef(0);
  if (instanceIdRef.current === 0) {
    instanceIdRef.current = nextThemeHookInstanceId++;
  }

  const initialStateRef = useRef<ReturnType<typeof initialThemeState> | null>(null);
  if (initialStateRef.current === null) {
    initialStateRef.current = initialThemeState(initialTheme);
  }

  const [themeScope, setThemeScopeState] = useState<ThemeConfigScope>(() => initialStateRef.current?.scope ?? DEFAULT_THEME_SCOPE);
  const [themeSet, setThemeSetState] = useState(() => initialStateRef.current?.themeSet ?? normalizeThemeSet(DEFAULT_THEME_SET));
  // Resolve the first render's variant with the server-known sun status when
  // the caller has one — an "auto" selection resolved sunless falls back to an
  // hour-of-day guess, which paints the wrong variant's colours on first load
  // (and during SSR the guess runs on the server clock/timezone).
  const initialResolvedTheme = resolveDeviceTheme(
    initialStateRef.current?.themeSet ?? normalizeThemeSet(DEFAULT_THEME_SET),
    initialSun ?? null,
  );
  const [activeVariant, setActiveVariant] = useState<ThemeVariant>(initialResolvedTheme.activeVariant);
  const [theme, setThemeState] = useState(() => initialResolvedTheme.theme);
  const [runtimeThemeOverride, setRuntimeThemeOverride] = useState<DeviceTheme | null>(() => housePartyThemeOverride);
  const [themeReady, setThemeReady] = useState(initialStateRef.current?.ready ?? false);
  const [themeSource, setThemeSource] = useState<ThemeSource>(initialStateRef.current?.source ?? "default");
  const themeScopeRef = useRef(themeScope);
  const themeSetRef = useRef(themeSet);
  const themeRef = useRef(theme);
  const activeVariantRef = useRef(activeVariant);
  const sunStatusRef = useRef<SunThemeStatus | null>(initialSun ?? null);

  const applyThemeSet = useCallback((
    value: ThemeStorageValue | null | undefined,
    options: {
      broadcast?: boolean;
      persist?: boolean;
      source?: ThemeSource;
      sun?: SunThemeStatus | null;
    } = {},
  ) => {
    const normalized = normalizeThemeSet(value, DEFAULT_THEME_SET);
    const sun = options.sun === undefined ? sunStatusRef.current : options.sun;
    const resolved = resolveDeviceTheme(normalized, sun);
    const source = options.source;

    themeSetRef.current = normalized;
    themeRef.current = resolved.theme;
    activeVariantRef.current = resolved.activeVariant;
    setThemeSetState(normalized);
    setThemeState(resolved.theme);
    setActiveVariant(resolved.activeVariant);
    if (source) {
      setThemeSource(source);
    }
    lastResolvedDocumentTheme = resolved.theme;
    applyDeviceTheme(documentThemeOverride ?? housePartyThemeOverride ?? resolved.theme);
    writeThemeCookie(normalized);

    if (options.persist) {
      // A user edit: suppress the background shared-theme poll for a few seconds
      // so an in-flight fetch can't overwrite the value being adjusted.
      pauseThemePolling();
      if (themeScopeRef.current === "shared") {
        writeSharedThemeCache(normalized);
        scheduleSharedThemeWrite(normalized);
      } else {
        writeLocalTheme(normalized);
      }
    }

    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));

    if (options.broadcast !== false) {
      window.dispatchEvent(new CustomEvent(NOVA_THEME_SET_CHANGE_EVENT, {
        detail: {
          originId: instanceIdRef.current,
          scope: themeScopeRef.current,
          source,
          sun,
          themeSet: normalized,
        },
      }));
    }
  }, []);

  const loadTheme = useCallback(async (
    requestedScope: ThemeConfigScope = readThemeScope(),
    options: { background?: boolean } = {},
  ) => {
    if (options.background && isThemePollingPaused()) {
      return;
    }
    const nextScope = normalizeThemeScope(requestedScope);
    const fallback = initialTheme ?? DEFAULT_THEME_SET;
    themeScopeRef.current = nextScope;
    setThemeScopeState(nextScope);

    try {
      const nextThemeSet = nextScope === "shared"
        ? await readSharedThemeSet(fallback)
        : readLocalThemeSet(fallback);
      const source: ThemeSource = nextScope === "shared" ? "api-theme" : "local-storage";
      if (options.background && isThemePollingPaused()) {
        setThemeReady(true);
        return;
      }
      const nextSun = nextThemeSet.selection === "auto"
        ? await readSunStatus().catch(() => sunStatusRef.current)
        : sunStatusRef.current;

      // A background poll whose fetch was already in flight when the user started
      // editing must not clobber the in-progress edit — skip applying the value
      // we just read (the debounced write reconciles the server and cache).
      if (options.background && isThemePollingPaused()) {
        setThemeReady(true);
        return;
      }

      if (nextScope === "shared") {
        writeSharedThemeCache(nextThemeSet);
      }
      sunStatusRef.current = nextSun;
      applyThemeSet(nextThemeSet, { source, sun: nextSun });
      writeThemeScopeCookie(nextScope);
      setThemeReady(true);
    } catch (error) {
      console.error("[nova-dashboard] failed to load dashboard theme", error);
      setThemeReady(true);
    }
  }, [applyThemeSet, initialTheme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        event.key !== THEME_STORAGE_KEY &&
        event.key !== THEME_SCOPE_STORAGE_KEY &&
        event.key !== SHARED_THEME_STORAGE_KEY
      ) {
        return;
      }

      if (isThemePollingPaused()) {
        return;
      }

      void loadTheme();
    };
    const onScopeChange = () => void loadTheme();
    const onThemeSetChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = recordValue(event.detail);
      const themeSetDetail = detail?.themeSet ?? (detail?.themes ? detail : null);
      if (!detail || !themeSetDetail || Number(detail.originId) === instanceIdRef.current) {
        return;
      }

      const eventScope = normalizeThemeScope(detail.scope ?? themeScopeRef.current);
      if (eventScope !== themeScopeRef.current) {
        return;
      }

      const nextSun = Object.hasOwn(detail, "sun")
        ? detail.sun as SunThemeStatus | null
        : sunStatusRef.current;
      sunStatusRef.current = nextSun;
      applyThemeSet(themeSetDetail as ThemeStorageValue, { broadcast: false, source: "event", sun: nextSun });
      setThemeReady(true);
    };
    const onSunChange = (event: Event) => {
      if (isThemePollingPaused()) {
        return;
      }
      const nextSun = event instanceof CustomEvent ? event.detail as SunThemeStatus | null : null;
      sunStatusRef.current = nextSun;
      if (themeSetRef.current.selection === "auto") {
        applyThemeSet(themeSetRef.current, { sun: nextSun });
      }
    };
    const onHousePartyThemeOverride = (event: Event) => {
      setRuntimeThemeOverride(
        event instanceof CustomEvent && event.detail
          ? normalizeTheme(event.detail as DeviceTheme)
          : null,
      );
    };

    void loadTheme();
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
    window.addEventListener(NOVA_THEME_SET_CHANGE_EVENT, onThemeSetChange);
    window.addEventListener(SUN_CHANGE_EVENT, onSunChange);
    window.addEventListener(HOUSE_PARTY_THEME_OVERRIDE_EVENT, onHousePartyThemeOverride);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
      window.removeEventListener(NOVA_THEME_SET_CHANGE_EVENT, onThemeSetChange);
      window.removeEventListener(SUN_CHANGE_EVENT, onSunChange);
      window.removeEventListener(HOUSE_PARTY_THEME_OVERRIDE_EVENT, onHousePartyThemeOverride);
    };
  }, [applyThemeSet, loadTheme]);

  useEffect(() => {
    if (themeScope !== "shared") {
      return;
    }

    const interval = window.setInterval(() => {
      // Don't poll over the top of a value the user is actively editing.
      if (isThemePollingPaused()) {
        return;
      }
      void loadTheme("shared", { background: true });
    }, SHARED_THEME_POLL_MS);

    return () => window.clearInterval(interval);
  }, [loadTheme, themeScope]);

  const setTheme = useCallback((next: DeviceTheme, options: { persist?: boolean } = {}) => {
    const normalized = normalizeTheme(next);
    applyThemeSet({
      ...themeSetRef.current,
      themes: {
        ...themeSetRef.current.themes,
        [activeVariantRef.current]: normalized,
      },
    }, { persist: options.persist ?? true, source: "set" });
  }, [applyThemeSet]);

  const setThemeVariant = useCallback((variant: ThemeVariant, next: DeviceTheme, options: { persist?: boolean } = {}) => {
    const normalizedVariant = normalizeThemeVariant(variant);
    applyThemeSet({
      ...themeSetRef.current,
      themes: {
        ...themeSetRef.current.themes,
        [normalizedVariant]: normalizeTheme(next),
      },
    }, { persist: options.persist ?? true, source: "set" });
  }, [applyThemeSet]);

  const setThemeSet = useCallback((next: ThemeStorageValue) => {
    applyThemeSet(next, { persist: true, source: "set" });
  }, [applyThemeSet]);

  const setThemeSelection = useCallback((
    nextSelection: ThemeSelection,
    options: { persist?: boolean } = {},
  ) => {
    const selection = normalizeThemeSelection(nextSelection);
    const nextThemeSet = {
      ...themeSetRef.current,
      selection,
    };

    const persist = options.persist ?? true;
    if (selection !== "auto" || !persist) {
      applyThemeSet(nextThemeSet, { persist, source: "set" });
      return;
    }

    void readSunStatus()
      .then((nextSun) => {
        sunStatusRef.current = nextSun;
        applyThemeSet(nextThemeSet, { persist: true, source: "set", sun: nextSun });
      })
      .catch(() => applyThemeSet(nextThemeSet, { persist: true, source: "set" }));
  }, [applyThemeSet]);

  const setThemeScope = useCallback((nextScope: ThemeConfigScope) => {
    const normalized = normalizeThemeScope(nextScope);
    writeThemeScope(normalized);
    themeScopeRef.current = normalized;
    setThemeScopeState(normalized);
    window.dispatchEvent(new CustomEvent(THEME_SCOPE_CHANGE_EVENT));
    void loadTheme(normalized);
  }, [loadTheme]);

  const setThemeColor = useCallback(
    (slot: ThemeColorSlot | "background", value: ThemeColorValue) => {
      setTheme({ ...themeRef.current, [slot]: value });
    },
    [setTheme],
  );

  const resetTheme = useCallback(() => {
    const nextThemeSet = normalizeThemeSet(DEFAULT_THEME_SET);

    setThemeReady(true);

    if (themeScopeRef.current === "shared") {
      applyThemeSet(nextThemeSet, { persist: true, source: "set" });
      return;
    }

    applyThemeSet(nextThemeSet, { source: "set" });
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    removeThemeCookie();
  }, [applyThemeSet]);

  return {
    activeVariant,
    resetTheme,
    setTheme,
    setThemeColor,
    setThemeScope,
    setThemeSelection,
    setThemeSet,
    setThemeVariant,
    configuredTheme: theme,
    theme: runtimeThemeOverride ?? theme,
    themeReady,
    themeScope,
    themeSource,
    themeSet,
  };
}
