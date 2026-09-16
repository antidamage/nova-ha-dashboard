"use client";

import { ALERT_PULSE_RATE_DEFAULT, DEFAULT_NOVA_AVATAR_THEME, DEFAULT_NOVA_GLASS_SETTINGS } from "./constants";
import type { AvatarThemeColorValue, NovaAvatarTheme, NovaGlassSettings } from "./types";

/**
 * The alert period multiplier for a 0-100 rate. A halving every 25 points, so
 * the ends are a quarter and four times the module's own period and the
 * midpoint is exactly 1 — every module keeps its declared cadence until the
 * slider is moved.
 */
export function alertPulseScale(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return 2 ** ((clamp(rate, 0, 100) - ALERT_PULSE_RATE_DEFAULT) / 25);
}

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
    alertPulseRate: normalizeOpacity(v.alertPulseRate, DEFAULT_NOVA_AVATAR_THEME.alertPulseRate),
  };
}
