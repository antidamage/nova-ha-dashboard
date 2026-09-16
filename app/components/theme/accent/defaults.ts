"use client";

// The shipped dark and light themes and the default DeviceThemeSet.
import { ALERT_PULSE_RATE_DEFAULT, DEFAULT_NOVA_GLASS_SETTINGS } from "../../avatarThemeModel";
import { DEFAULT_UX_SOUNDS } from "../../dashboard/uxSoundActions";
import { DEFAULT_CLOCK_FONT_ID, DEFAULT_THEME_FONT_ID } from "../../themeFonts";
import {
  DEFAULT_CONTROL_SOUND,
  DEFAULT_THEME_SELECTION,
  LIGHTING_TINT_STRENGTH_DEFAULT,
  VOICE_TRANSCRIPT_GLOW_INTENSITY_DEFAULT,
  VOICE_TRANSCRIPT_GLOW_SIZE_DEFAULT,
  VOICE_TRANSCRIPT_SCANLINE_OPACITY_DEFAULT,
  VOICE_TRANSCRIPT_SCANLINE_SCALE_DEFAULT,
} from "./constants";
import type { DeviceTheme, DeviceThemeSet, ThemeFontSetting } from "./types";

export const DEFAULT_DISPLAY_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };
// Numbers/clock currently render bold (Tailwind font-black ~900); default to 900 so
// the migration preserves the existing look.
export const DEFAULT_CLOCK_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_CLOCK_FONT_ID, weight: 900, sizeOffset: 0 };
export const DEFAULT_GYM_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };
export const DEFAULT_TRANSCRIPT_FONT_SETTING: ThemeFontSetting = { id: DEFAULT_THEME_FONT_ID, weight: 500, sizeOffset: 0 };

const NOVA_DEFAULT_BACKGROUND_TEXTURE_URL = "/nova-background-texture.png";

export const DEFAULT_DARK_THEME: DeviceTheme = {
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
    alertPulseRate: ALERT_PULSE_RATE_DEFAULT,
  },
  background: {
    cursor: { x: 0.12327065494504236, y: 0.3238836015973772 },
    intensity: 15,
    rgb: [227, 196, 109],
  },
  panel: {
    color: {
      cursor: { x: 0.12327065494504236, y: 0.3238836015973772 },
      intensity: 13,
      rgb: [227, 196, 109],
    },
    opacity: 100,
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
    ipadAssetId: null,
    landscapeAssetId: null,
    portraitAssetId: null,
    useAsDashboardBackground: false,
  },
  border: {
    color: {
      cursor: { x: 0.1291995687432164, y: 0 },
      intensity: 100,
      rgb: [255, 196, 0],
    },
    opacity: 15,
  },
  headerFade: {
    color: {
      cursor: { x: 0, y: 0 },
      intensity: 0,
      rgb: [255, 255, 255],
    },
    opacity: 100,
  },
  clockColor: {
    cursor: { x: 0.12228260316437417, y: 0.4738834926060268 },
    intensity: 87,
    rgb: [224, 205, 154],
  },
  clockFont: { ...DEFAULT_CLOCK_FONT_SETTING },
  controlSound: { ...DEFAULT_CONTROL_SOUND },
  uxSounds: { ...DEFAULT_UX_SOUNDS },
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
  knobSkin: "auto",
  ledColor: {
    cursor: { x: 0, y: 1 },
    intensity: 100,
    rgb: [255, 255, 255],
  },
  mapBuildingOpacity: 66,
  mapLabelSize: 150,
  mapSatellite: true,
  lightingTint: false,
  lightingTintStrength: LIGHTING_TINT_STRENGTH_DEFAULT,
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

export const DEFAULT_LIGHT_THEME: DeviceTheme = {
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
    alertPulseRate: ALERT_PULSE_RATE_DEFAULT,
  },
  background: {
    cursor: { x: 0.1351284825413904, y: 0.3667411804199219 },
    intensity: 34,
    rgb: [225, 206, 122],
  },
  panel: {
    color: {
      cursor: { x: 0.1351284825413904, y: 0.3667411804199219 },
      intensity: 29,
      rgb: [225, 206, 122],
    },
    opacity: 100,
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
    ipadAssetId: null,
    landscapeAssetId: null,
    portraitAssetId: null,
    useAsDashboardBackground: false,
  },
  border: {
    color: {
      cursor: { x: 0.13611668510059982, y: 0 },
      intensity: 100,
      rgb: [255, 208, 0],
    },
    opacity: 19,
  },
  headerFade: {
    color: {
      cursor: { x: 0, y: 0 },
      intensity: 0,
      rgb: [255, 255, 255],
    },
    opacity: 100,
  },
  clockColor: {
    cursor: { x: 0.7818660545503647, y: 0 },
    intensity: 0,
    rgb: [174, 0, 255],
  },
  clockFont: { ...DEFAULT_CLOCK_FONT_SETTING },
  controlSound: { ...DEFAULT_CONTROL_SOUND },
  uxSounds: { ...DEFAULT_UX_SOUNDS },
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
  knobSkin: "auto",
  ledColor: {
    cursor: { x: 0, y: 1 },
    intensity: 100,
    rgb: [255, 255, 255],
  },
  mapBuildingOpacity: 66,
  mapLabelSize: 150,
  mapSatellite: true,
  lightingTint: false,
  lightingTintStrength: LIGHTING_TINT_STRENGTH_DEFAULT,
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
