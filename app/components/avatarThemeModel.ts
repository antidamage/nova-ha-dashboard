"use client";

export type AvatarThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

export type NovaAvatarTheme = {
  gradientAlert: AvatarThemeColorValue;
  gradientCenter: AvatarThemeColorValue;
  gradientOuter: AvatarThemeColorValue;
  gymAlertThresholdHours: number;
  gymNumberColor: AvatarThemeColorValue;
  gymNumberOpacity: number;
  // Colour of the voice-listening glow ring that fades in behind the status orb
  // while this device owns an active voice conversation (see NovaAvatar). Unlike
  // the other orb colours this one skins a DOM element behind the canvas rather
  // than a canvas layer, so it is also surfaced as the --nova-avatar-voice-glow
  // CSS var; it is included in the renderer palette for cross-platform parity.
  voiceGlowColor: AvatarThemeColorValue;
  lineColors: [AvatarThemeColorValue, AvatarThemeColorValue, AvatarThemeColorValue];
  lineOpacities: [number, number, number];
  // Opacity (0..1) of the orb's dark inner bevel shadow. Shared config only —
  // intentionally not surfaced in the avatar config UI. All avatar renderers
  // (web + tvOS) reference this so the inner shadow stays consistent.
  innerShadowOpacity: number;
  // Id of the status orb module this theme renders with (see
  // lib/orb-modules.ts). The module defines the orb's layer stack — shape,
  // proportions, animation — while the colors above skin it. Unknown ids fall
  // back to the built-in "classic" module on every platform.
  orbModule: string;
  // Saved values for the per-module config sliders (OrbModule.settings),
  // keyed by module id then setting id, so each module keeps its own tuning
  // when the user switches between them. Values are kept as finite numbers
  // here; clamping to each setting's declared range happens at resolve time
  // (resolveOrbModuleSettings in lib/orb-modules.ts) so this model stays
  // dependency-free.
  orbModuleSettings: Record<string, Record<string, number>>;
};

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
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(value: unknown, fallback: AvatarThemeColorValue): AvatarThemeColorValue {
  const v = (value ?? {}) as Partial<AvatarThemeColorValue>;
  const rgb: [number, number, number] = Array.isArray(v.rgb) && v.rgb.length >= 3
    ? [
        clamp(Math.round(Number(v.rgb[0])), 0, 255),
        clamp(Math.round(Number(v.rgb[1])), 0, 255),
        clamp(Math.round(Number(v.rgb[2])), 0, 255),
      ]
    : fallback.rgb;
  const cursor = {
    x: clamp(Number(v.cursor?.x ?? fallback.cursor.x), 0, 1),
    y: clamp(Number(v.cursor?.y ?? fallback.cursor.y), 0, 1),
  };
  const intensity = clamp(Math.round(Number(v.intensity ?? fallback.intensity)), 0, 100);
  return { cursor, intensity, rgb };
}

function normalizeOpacity(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 0, 100) : fallback;
}

export function normalizeGymAlertThresholdHours(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 168) : DEFAULT_NOVA_AVATAR_THEME.gymAlertThresholdHours;
}

function normalizeInnerShadowOpacity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : DEFAULT_NOVA_AVATAR_THEME.innerShadowOpacity;
}

// Mirrors isValidOrbModuleId in lib/orb-modules.ts (kept inline so this
// client model stays dependency-free): ids are short, url/file-safe slugs.
const ORB_MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function normalizeOrbModuleId(value: unknown) {
  return typeof value === "string" && value.length <= 64 && ORB_MODULE_ID_PATTERN.test(value)
    ? value
    : DEFAULT_NOVA_AVATAR_THEME.orbModule;
}

// Same id charset for setting ids (mirrors the module-id rule above).
function isSlugKey(value: string) {
  return value.length > 0 && value.length <= 64 && ORB_MODULE_ID_PATTERN.test(value);
}

// Keep only { moduleId: { settingId: finiteNumber } } shapes. Range clamping
// is deliberately NOT done here — it needs the module's setting declarations,
// which live in lib/orb-modules.ts (see the field comment on the type).
function normalizeOrbModuleSettings(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, Record<string, number>> = {};
  for (const [moduleId, group] of Object.entries(value as Record<string, unknown>)) {
    if (!isSlugKey(moduleId) || !group || typeof group !== "object" || Array.isArray(group)) {
      continue;
    }
    const settings: Record<string, number> = {};
    for (const [settingId, raw] of Object.entries(group as Record<string, unknown>)) {
      const parsed = Number(raw);
      if (isSlugKey(settingId) && Number.isFinite(parsed)) {
        settings[settingId] = parsed;
      }
    }
    if (Object.keys(settings).length > 0) {
      result[moduleId] = settings;
    }
  }
  return result;
}

export function normalizeNovaAvatarTheme(value: unknown): NovaAvatarTheme {
  const v = (value ?? {}) as Partial<NovaAvatarTheme>;
  const lines = Array.isArray(v.lineColors) ? v.lineColors : [];
  const opacities = Array.isArray(v.lineOpacities) ? v.lineOpacities : [];
  return {
    gradientAlert: normalizeColor(v.gradientAlert, DEFAULT_NOVA_AVATAR_THEME.gradientAlert),
    gradientCenter: normalizeColor(v.gradientCenter, DEFAULT_NOVA_AVATAR_THEME.gradientCenter),
    gradientOuter: normalizeColor(v.gradientOuter, DEFAULT_NOVA_AVATAR_THEME.gradientOuter),
    gymAlertThresholdHours: normalizeGymAlertThresholdHours(v.gymAlertThresholdHours),
    gymNumberColor: normalizeColor(v.gymNumberColor, DEFAULT_NOVA_AVATAR_THEME.gymNumberColor),
    gymNumberOpacity: normalizeOpacity(v.gymNumberOpacity, DEFAULT_NOVA_AVATAR_THEME.gymNumberOpacity),
    voiceGlowColor: normalizeColor(v.voiceGlowColor, DEFAULT_NOVA_AVATAR_THEME.voiceGlowColor),
    lineColors: [
      normalizeColor(lines[0], DEFAULT_NOVA_AVATAR_THEME.lineColors[0]),
      normalizeColor(lines[1], DEFAULT_NOVA_AVATAR_THEME.lineColors[1]),
      normalizeColor(lines[2], DEFAULT_NOVA_AVATAR_THEME.lineColors[2]),
    ],
    lineOpacities: [
      normalizeOpacity(opacities[0], DEFAULT_NOVA_AVATAR_THEME.lineOpacities[0]),
      normalizeOpacity(opacities[1], DEFAULT_NOVA_AVATAR_THEME.lineOpacities[1]),
      normalizeOpacity(opacities[2], DEFAULT_NOVA_AVATAR_THEME.lineOpacities[2]),
    ],
    innerShadowOpacity: normalizeInnerShadowOpacity(v.innerShadowOpacity),
    orbModule: normalizeOrbModuleId(v.orbModule),
    orbModuleSettings: normalizeOrbModuleSettings(v.orbModuleSettings),
  };
}
