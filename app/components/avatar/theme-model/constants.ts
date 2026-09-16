"use client";

import type { NovaAvatarTheme, NovaGlassSettings } from "./types";

export const DEFAULT_NOVA_GLASS_SETTINGS: NovaGlassSettings = {
  enabled: true,
  // "Max refraction" default: a bold, obvious background bend with a sharp
  // fisheye rim. Every value is user-tunable in the Status Orb config.
  displace: 85,
  localStretch: 0,
  flipVertical: false,
  refractPower: 50,
  smoothness: 30,
  imageBlur: 0,
  refractionOpacity: 100,
  clarity: 60,
  gloss: 50,
  shadow: 50,
  reflection: 55,
  drift: 60,
};

/** Neither fast nor slow: the module's own period, untouched. */
export const ALERT_PULSE_RATE_DEFAULT = 50;

// Cursor positions chosen so the spectrum's HSL math yields roughly the
// previous default rgbs (deep purple, blacks, blue/purple/cyan lines).
// (themeRgbAtPosition: hue = x*359, sat = (1-y)*100, light = 50 + y*50)
export const DEFAULT_NOVA_AVATAR_THEME: NovaAvatarTheme = {
  gradientCenter: {
    cursor: { x: 0.78, y: 0 },
    intensity: 28,
    rgb: [216, 0, 255],
  },
  gradientOuter: {
    cursor: { x: 0.78, y: 0 },
    intensity: 0,
    rgb: [216, 0, 255],
  },
  gradientAlert: {
    cursor: { x: 0, y: 0 },
    intensity: 100,
    rgb: [255, 0, 0],
  },
  gymNumberColor: {
    cursor: { x: 0, y: 1 },
    intensity: 100,
    rgb: [255, 255, 255],
  },
  gymNumberOpacity: 50,
  gymAlertThresholdHours: 46,
  voiceGlowColor: {
    cursor: { x: 0.53, y: 0 },
    intensity: 100,
    rgb: [60, 220, 240],
  },
  lineColors: [
    { cursor: { x: 0.63, y: 0 }, intensity: 100, rgb: [80, 130, 255] },
    { cursor: { x: 0.79, y: 0 }, intensity: 100, rgb: [180, 95, 240] },
    { cursor: { x: 0.53, y: 0 }, intensity: 100, rgb: [60, 220, 240] },
  ],
  lineOpacities: [100, 100, 100],
  innerShadowOpacity: 0.5,
  orbModule: "classic",
  orbModuleSettings: {},
  glass: DEFAULT_NOVA_GLASS_SETTINGS,
  alertPulseRate: ALERT_PULSE_RATE_DEFAULT,
};
