// Theme shapes. Types only; import this file directly, not through the facade.
import type { NovaAvatarTheme } from "../../avatarThemeModel";
import type { UxSoundAssignments } from "../../dashboard/uxSoundActions";

export type ThemeColorSlot = "accent" | "highlight";
export type ThemeConfigScope = "local" | "shared";
export type ThemeSelection = "auto" | "dark" | "light";
export type ThemeVariant = "dark" | "light";
export type ThemeTitleTone = "auto" | "light" | "dark";
export type RadarPaletteMode = "spectrum" | "custom";
export type KnobSkinMode = "auto" | "dark" | "light";
export type MapThemeColorSlot = "base" | "water" | "land" | "buildingLow" | "buildingHigh" | "roads" | "labels" | "radarLow" | "radarHigh";

export type ThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

export type ThemeBorderValue = {
  color: ThemeColorValue;
  opacity: number;
};

/** The stacked panels' fill and its alpha. See specs/panel-surface.md. */
export type ThemePanelValue = {
  color: ThemeColorValue;
  opacity: number;
};

/** Same pair as the border: the header fade strip's colour and its own alpha. */
export type ThemeHeaderFadeValue = {
  color: ThemeColorValue;
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
  ipadAssetId: string | null;
  landscapeAssetId: string | null;
  portraitAssetId: string | null;
  useAsDashboardBackground: boolean;
};

// Volume for every UX sound this theme plays. The clips themselves live in the
// sound library and are chosen per action in `uxSounds`; there is no per-action
// volume (specs/ux-sounds.md).
export type ControlSoundSettings = {
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

export type DeviceTheme = Record<ThemeColorSlot, ThemeColorValue> & {
  avatar: NovaAvatarTheme;
  background: ThemeColorValue;
  backgroundEffect: FluidBackgroundSettings;
  border: ThemeBorderValue;
  /** The shadow under the status orb as the page scrolls; see
   *  specs/header-fade.md. The scroll supplies the multiplier on top. */
  headerFade: ThemeHeaderFadeValue;
  /** Fill of every stacked panel (--cyber-panel / --cyber-panel-soft), with
   *  true alpha. See specs/panel-surface.md. */
  panel: ThemePanelValue;
  clockColor: ThemeColorValue;
  clockFont: ThemeFontSetting;
  controlSound: ControlSoundSettings;
  /** Which library sound each UX action plays (specs/ux-sounds.md). */
  uxSounds: UxSoundAssignments;
  desktopWallpaper: DesktopWallpaperSettings;
  font: ThemeFontSetting;
  gymFont: ThemeFontSetting;
  /** ColorEncoder's bevel/LED skin for this theme variant. "auto" keeps the
   *  knob's own luminance detection; see specs/color-encoder.md, "Light and dark". */
  knobSkin: KnobSkinMode;
  /** The lit lights on every RotaryEncoder-derived knob, and their glow.
   *  White by default; see specs/color-encoder.md, "The LED colour". */
  ledColor: ThemeColorValue;
  /** Blend the room's light colour over the page. See specs/lighting-tint.md. */
  lightingTint: boolean;
  lightingTintStrength: number;
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

export type StoredMapTheme = Partial<Record<MapThemeColorSlot, Partial<ThemeColorValue>>> & {
  buildings?: Partial<ThemeColorValue>;
  majorRoads?: Partial<ThemeColorValue>;
  minorRoads?: Partial<ThemeColorValue>;
};

// Per-device theme override (specs/theme-override.md).
export type ThemeOverride = ThemeSelection | "unset";
