import { PHONOSCOPE_MODULE_ID, type PhonoscopeSetting } from "../phonoscope";
import { decimalStepGranularity } from "../slider-step";
import type { PhonoscopeColorTheme, PhonoscopeColorValue } from "../types";
import { DEFAULT_COLORS } from "./constants";

function cloneDefaultColors() {
  return structuredClone(DEFAULT_COLORS);
}

function mixedColor(
  from: PhonoscopeColorValue,
  to: PhonoscopeColorValue,
  amount: number,
  opacity = from.opacity,
): PhonoscopeColorValue {
  return {
    rgb: from.rgb.map((part, index) =>
      Math.round(part + (to.rgb[index] - part) * amount)) as [number, number, number],
    intensity: from.intensity + (to.intensity - from.intensity) * amount,
    opacity,
    cursor: { x: 0.5, y: 0.5 },
  };
}

function particleRippleColors(
  colors: Record<string, PhonoscopeColorValue>,
  explicitlyConfigured: ReadonlySet<string> = new Set(),
) {
  const primary = colors.dotPrimary ?? colors.primary ?? DEFAULT_COLORS.primary;
  const secondary = colors.dotSecondary ?? colors.secondary ?? DEFAULT_COLORS.secondary;
  const tertiary = colors.tertiary ?? mixedColor(primary, secondary, 0.5);
  const background = colors.backgroundPrimary ?? colors.background ?? DEFAULT_COLORS.background;
  const assign = (id: string, value: PhonoscopeColorValue) => {
    if (!explicitlyConfigured.has(id)) colors[id] = structuredClone(value);
  };
  assign("backgroundPrimary", background);
  assign("backgroundSecondary", mixedColor(background, primary, 0.22, background.opacity));
  assign("dotPrimary", primary);
  assign("dotSecondary", secondary);
  assign("glowPrimary", mixedColor(secondary, { ...secondary, rgb: [255, 255, 255] }, 0.28));
  assign("glowSecondary", mixedColor(tertiary, secondary, 0.62));
  assign("linePrimary", { ...structuredClone(tertiary), opacity: 42 });
  assign("lineSecondary", { ...structuredClone(secondary), opacity: 58 });
  assign("trailPrimary", { ...structuredClone(primary), opacity: 72 });
  assign("trailSecondary", { ...structuredClone(secondary), opacity: 38 });
  delete colors.primary;
  delete colors.secondary;
  delete colors.tertiary;
  delete colors.background;
  return colors;
}

function normalizedColor(value: unknown, fallback: PhonoscopeColorValue): PhonoscopeColorValue {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rgb = Array.isArray(raw.rgb) && raw.rgb.length === 3
    ? raw.rgb.map((part, index) => Number.isFinite(Number(part))
      ? Math.max(0, Math.min(255, Math.round(Number(part))))
      : fallback.rgb[index]) as [number, number, number]
    : fallback.rgb;
  const cursor = raw.cursor && typeof raw.cursor === "object" && !Array.isArray(raw.cursor)
    ? raw.cursor as Record<string, unknown>
    : null;
  return {
    rgb,
    intensity: Number.isFinite(Number(raw.intensity))
      ? Math.max(0, Math.min(100, Number(raw.intensity)))
      : fallback.intensity,
    opacity: Number.isFinite(Number(raw.opacity))
      ? Math.max(0, Math.min(100, Number(raw.opacity)))
      : fallback.opacity,
    ...(cursor && Number.isFinite(Number(cursor.x)) && Number.isFinite(Number(cursor.y))
      ? { cursor: {
          x: Math.max(0, Math.min(1, Number(cursor.x))),
          y: Math.max(0, Math.min(1, Number(cursor.y))),
        } }
      : fallback.cursor ? { cursor: fallback.cursor } : {}),
  };
}

export function finiteClamped(value: unknown, fallback: number, min: number, max: number) {
  return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
}


export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}


export function normalizePhonoscopeColorThemes(value: unknown): PhonoscopeColorTheme[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((raw, index): PhonoscopeColorTheme[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `theme_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const colors: Record<string, PhonoscopeColorValue> = {};
    if (isRecord(raw.colors)) {
      for (const [slot, colour] of Object.entries(raw.colors)) {
        if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(slot)) continue;
        colors[slot] = normalizedColor(colour, DEFAULT_COLORS[slot] ?? DEFAULT_COLORS.primary);
      }
    }
    return [{
      id,
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Colour theme ${index + 1}`,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      colors,
      // The theme's own centre image. Null rather than "" so "this theme does
      // not supply one" is distinguishable from an id that has been cleared —
      // both mean nothing is drawn, but only one of them is a deliberate empty.
      imageId: typeof raw.imageId === "string" && raw.imageId ? raw.imageId.slice(0, 64) : null,
      // The theme's own backdrop, on the same terms. Null is what makes the
      // procedural field run: the two are one slot with two possible occupants,
      // not a picture layered over a field.
      backgroundImageId: typeof raw.backgroundImageId === "string" && raw.backgroundImageId
        ? raw.backgroundImageId.slice(0, 64)
        : null,
    }];
  });
}


export function readBoolean(source: unknown, key: string, fallback: boolean) {
  if (!isRecord(source)) return fallback;
  return typeof source[key] === "boolean" ? source[key] : fallback;
}

export function normalizeSettingValue(setting: PhonoscopeSetting, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (setting.control === "toggle") return value >= 0.5 ? 1 : 0;
  if (setting.control === "select") {
    return setting.options.some((option) => option.value === value) ? value : setting.default;
  }
  const clamped = Math.max(setting.min, Math.min(setting.max, value));
  const step = decimalStepGranularity(setting.step);
  const stepped = setting.min + Math.round((clamped - setting.min) / step) * step;
  return Number(Math.max(setting.min, Math.min(setting.max, stepped)).toFixed(12));
}

