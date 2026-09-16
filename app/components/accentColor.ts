"use client";

/**
 * Device theme (accent colours, fonts, map, sound) — facade. The body lives in
 * theme/accent/; this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   theme/accent/types.ts           theme shapes (import directly for types)
 *   theme/accent/constants.ts       slider ranges/defaults, storage keys, events
 *   theme/accent/font-scale.ts      themeFontSizeScale, normalizeThemeFontSetting
 *   theme/accent/defaults.ts        shipped dark/light themes, DEFAULT_THEME_SET
 *   theme/accent/color-model.ts     colour maths, mixDeviceThemeColors
 *   theme/accent/normalize-model.ts field normalisers
 *   theme/accent/theme-model.ts     normalizeTheme, normalizeThemeSet
 *   theme/accent/variant-model.ts   sun/selection/override -> variant
 *   theme/accent/apply-surfaces.ts  CSS vars: --cyber-line, highlight, border, panel
 *   theme/accent/apply-map.ts       CSS vars: map, radar, reminder glow
 *   theme/accent/apply.ts           applyDeviceTheme
 *   theme/accent/cookies.ts         theme and scope cookies
 *   theme/accent/client.ts          /api/theme and /api/state calls
 *   theme/accent/store.ts           SOLE owner of module state and localStorage:
 *                                   document/house-party pins, caches, override,
 *                                   debounced shared-theme write queue
 *   theme/accent/useDeviceTheme.ts  the useDeviceTheme hook
 */
export type {
  ControlSoundSettings,
  DesktopWallpaperSettings,
  DeviceTheme,
  DeviceThemeSet,
  FluidBackgroundSettings,
  KnobSkinMode,
  MapThemeColorSlot,
  RadarPaletteMode,
  SunThemeStatus,
  ThemeBorderValue,
  ThemeColorSlot,
  ThemeColorValue,
  ThemeConfigScope,
  ThemeFontSetting,
  ThemeHeaderFadeValue,
  ThemeMapLayerValue,
  ThemeOverride,
  ThemePanelValue,
  ThemeSelection,
  ThemeSource,
  ThemeStorageValue,
  ThemeTitleColors,
  ThemeTitleTone,
  ThemeVariant,
  ThemeVoiceTranscriptColors,
} from "./theme/accent/types";
export {
  CONTROL_SOUND_VOLUME_DEFAULT,
  CONTROL_SOUND_VOLUME_MAX,
  CONTROL_SOUND_VOLUME_MIN,
  DEFAULT_CONTROL_SOUND,
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
  KNOB_SKIN_MODES,
  LIGHTING_TINT_STRENGTH_DEFAULT,
  LIGHTING_TINT_STRENGTH_MAX,
  LIGHTING_TINT_STRENGTH_MIN,
  MAP_BUILDING_OPACITY_DEFAULT,
  MAP_BUILDING_OPACITY_MAX,
  MAP_BUILDING_OPACITY_MIN,
  MAP_LABEL_SIZE_DEFAULT,
  MAP_LABEL_SIZE_MAX,
  MAP_LABEL_SIZE_MIN,
  NOVA_THEME_SET_CHANGE_EVENT,
  RADAR_OPACITY_DEFAULT,
  RADAR_OPACITY_MAX,
  RADAR_OPACITY_MIN,
  TASK_GLOW_INTENSITY_DEFAULT,
  TASK_GLOW_INTENSITY_MAX,
  TASK_GLOW_INTENSITY_MIN,
  THEME_FONT_SIZE_OFFSET_MAX,
  THEME_FONT_SIZE_OFFSET_MIN,
  THEME_FONT_WEIGHT_DEFAULT,
  THEME_FONT_WEIGHT_MAX,
  THEME_FONT_WEIGHT_MIN,
  THEME_FONT_WEIGHT_STEP,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_CYCLE,
  THEME_OVERRIDE_STORAGE_KEY,
  THEME_SELECTIONS,
  THEME_VARIANTS,
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
} from "./theme/accent/constants";
export { normalizeThemeFontSetting, themeFontSizeScale } from "./theme/accent/font-scale";
export { DEFAULT_THEME, DEFAULT_THEME_SET } from "./theme/accent/defaults";
export { appliedThemeRgb, mixDeviceThemeColors, themeRgbAtPosition } from "./theme/accent/color-model";
export {
  normalizeControlSound,
  normalizeDesktopWallpaperSettings,
  normalizeFluidBackgroundSettings,
  normalizeRadarOpacity,
  normalizeTaskGlowIntensity,
} from "./theme/accent/normalize-model";
export { normalizeThemeSet } from "./theme/accent/theme-model";
export {
  effectiveThemeSelection,
  nextThemeOverride,
  normalizeThemeOverride,
  resolveDeviceTheme,
  resolveThemeVariant,
} from "./theme/accent/variant-model";
export { applyDeviceTheme } from "./theme/accent/apply";
export {
  flushPendingSharedThemeWrite,
  readThemeOverride,
  setDocumentThemeOverride,
  setHousePartyThemeOverride,
  writeThemeOverride,
} from "./theme/accent/store";
export { useDeviceTheme } from "./theme/accent/useDeviceTheme";
