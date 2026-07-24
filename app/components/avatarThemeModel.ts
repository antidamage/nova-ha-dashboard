"use client";

export type AvatarThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

/**
 * "Liquid glass" overlay settings for the status orb. These drive a DOM/SVG
 * layer that sits on top of the canvas orb (see NovaOrbGlass): an SVG
 * `feDisplacementMap` refracts the orb like a curved lens, a screen-blended
 * "silver room with overhead lights" reflection pans across it as the orb
 * moves on the page, and a gloss highlight + drop shadow sell the volume.
 *
 * The effect is DOM-only (SVG filters + blend modes), so unlike the orb
 * modules it has no tvOS counterpart — the Apple TV renderer simply never
 * draws it. Every knob is a 0-100 magnitude except `enabled`; the renderer
 * maps them to concrete pixel/filter values, so the stored model stays a set
 * of plain, hand-editable percentages. `localStretch` is the one signed
 * exception: it ranges from -100 to 100 around a neutral zero.
 */
export type NovaGlassSettings = {
  /** Master switch for the whole glass overlay. */
  enabled: boolean;
  /** backdrop-filter displacement scale — how far the lens refracts the page
   *  behind the orb (the whole disc refracts, artist "liquid glass" style). */
  displace: number;
  /** Signed size change of the refracted background image (-100..300).
   * 0 is neutral, +100 doubles it, +300 quadruples it, -100 collapses it. The
   * wide positive range lets the zoom read clearly; the old ±100 cap (max 2x)
   * was easy to miss over low-contrast content. */
  localStretch: number;
  /** Reverse the displacement map's vertical refraction direction. */
  flipVertical: boolean;
  /** Curvature of the modelled glass dome (0-100), driving how the concentric
   *  refraction rings accumulate. Low is a near-flat pane whose slope stays
   *  gentle across the disc; high is a near-full hemisphere whose slope runs
   *  away toward the rim, piling refraction into a thick fisheye edge. See
   *  refractDomeFullness / refractMagnitude in NovaOrbGlass. */
  refractPower: number;
  /** Gaussian blur on the displacement map — the "liquid"/melt softness. */
  smoothness: number;
  /** Gaussian blur (0-10px) applied to the refracted image itself, after the
   *  lens — a frosted-glass softening of what you see through the orb. Distinct
   *  from `smoothness`, which blurs the displacement map, not the image. A
   *  direct pixel value rather than a 0-100 magnitude. */
  imageBlur: number;
  /** Opacity (0-100) of the whole refraction group — cross-fades the refracted
   *  image back toward the plain (un-refracted) backdrop. 100 is full
   *  refraction; 0 shows the page unbent through the disc. */
  refractionOpacity: number;
  /** How see-through the orb core is — fades the canvas graphics toward the
   *  centre so the refraction reads through a mostly-clear middle. */
  clarity: number;
  /** Strength of the specular gloss highlight, fading in from the top edge. */
  gloss: number;
  /** Depth of the drop shadow cast beneath the orb. */
  shadow: number;
  /** Opacity of the silver-room reflection, fading in from the rim. */
  reflection: number;
  /** How far the reflection pans as the orb moves / the pointer sweeps. */
  drift: number;
};

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
  // "Liquid glass" overlay tuning (see NovaGlassSettings). Applies over any
  // orb module, so it lives on the theme rather than in a module's per-module
  // settings. DOM/SVG-only; no tvOS counterpart.
  glass: NovaGlassSettings;
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
  glass: DEFAULT_NOVA_GLASS_SETTINGS,
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

// Each glass knob is a 0-100 magnitude; `enabled` gates the whole overlay.
// A missing block yields the defaults so existing saved themes light the
// glass up on first load without a migration.
export function normalizeNovaGlassSettings(value: unknown): NovaGlassSettings {
  const v = (value ?? {}) as Partial<NovaGlassSettings>;
  const pct = (raw: unknown, fallback: number) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clamp(Math.round(parsed), 0, 100) : fallback;
  };
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_NOVA_GLASS_SETTINGS.enabled,
    displace: pct(v.displace, DEFAULT_NOVA_GLASS_SETTINGS.displace),
    localStretch: Number.isFinite(Number(v.localStretch))
      ? clamp(Math.round(Number(v.localStretch)), -100, 300)
      : DEFAULT_NOVA_GLASS_SETTINGS.localStretch,
    flipVertical: typeof v.flipVertical === "boolean"
      ? v.flipVertical
      : DEFAULT_NOVA_GLASS_SETTINGS.flipVertical,
    refractPower: pct(v.refractPower, DEFAULT_NOVA_GLASS_SETTINGS.refractPower),
    smoothness: pct(v.smoothness, DEFAULT_NOVA_GLASS_SETTINGS.smoothness),
    imageBlur: Number.isFinite(Number(v.imageBlur))
      ? clamp(Math.round(Number(v.imageBlur) * 2) / 2, 0, 10)
      : DEFAULT_NOVA_GLASS_SETTINGS.imageBlur,
    refractionOpacity: pct(v.refractionOpacity, DEFAULT_NOVA_GLASS_SETTINGS.refractionOpacity),
    clarity: pct(v.clarity, DEFAULT_NOVA_GLASS_SETTINGS.clarity),
    gloss: pct(v.gloss, DEFAULT_NOVA_GLASS_SETTINGS.gloss),
    shadow: pct(v.shadow, DEFAULT_NOVA_GLASS_SETTINGS.shadow),
    reflection: pct(v.reflection, DEFAULT_NOVA_GLASS_SETTINGS.reflection),
    drift: pct(v.drift, DEFAULT_NOVA_GLASS_SETTINGS.drift),
  };
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
    glass: normalizeNovaGlassSettings(v.glass),
  };
}
