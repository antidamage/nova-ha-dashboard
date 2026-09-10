/**
 * HSVA maths and storage adapters for `ColorEncoder` (specs/color-encoder.md).
 *
 * The encoder thinks in HSVA because that is what a lighting dial means by
 * "brightness", and because HSV scales multiplicatively in V: HSV(h,s,v) is
 * exactly `HSV(h,s,100) × v/100`. That identity is what lets the encoder keep
 * writing the existing `ThemeColorValue` shape — rgb at full value plus
 * `intensity` — with no migration, since `appliedThemeRgb` already multiplies
 * the two back together.
 *
 * HSL conversion is deliberately absent here: three copies of `hslToRgb`
 * already exist in this repo (`accentColor.ts`, `dashboard/lighting.ts`,
 * `lib/wallpaper-color.ts`) and this file is not a fourth.
 */
import type { ThemeColorValue } from "./accentColor";

export type Rgb = [number, number, number];

/** Hue wraps 0–360; saturation, value and alpha are all 0–100. */
export type Hsva = {
  h: number;
  s: number;
  v: number;
  a: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Wraps into 0–360, handling negatives (a hue dial turns both ways forever). */
export function wrapHue(hue: number) {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function normalizeHsva(value: Partial<Hsva> | null | undefined): Hsva {
  const source = value ?? {};
  return {
    h: wrapHue(Number.isFinite(source.h) ? Number(source.h) : 0),
    s: clamp(Number.isFinite(source.s) ? Number(source.s) : 0, 0, 100),
    v: clamp(Number.isFinite(source.v) ? Number(source.v) : 0, 0, 100),
    a: clamp(Number.isFinite(source.a) ? Number(source.a) : 100, 0, 100),
  };
}

export function hsvToRgb(hue: number, saturation: number, value: number): Rgb {
  const h = wrapHue(hue);
  const s = clamp(saturation, 0, 100) / 100;
  const v = clamp(value, 0, 100) / 100;

  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = v - chroma;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = chroma;
    g = secondary;
  } else if (h < 120) {
    r = secondary;
    g = chroma;
  } else if (h < 180) {
    g = chroma;
    b = secondary;
  } else if (h < 240) {
    g = secondary;
    b = chroma;
  } else if (h < 300) {
    r = secondary;
    b = chroma;
  } else {
    r = chroma;
    b = secondary;
  }

  return [
    Math.round((r + base) * 255),
    Math.round((g + base) * 255),
    Math.round((b + base) * 255),
  ];
}

export function rgbToHsv(rgb: Rgb): { h: number; s: number; v: number } {
  const r = clamp(rgb[0], 0, 255) / 255;
  const g = clamp(rgb[1], 0, 255) / 255;
  const b = clamp(rgb[2], 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;

  let h = 0;
  if (chroma !== 0) {
    if (max === r) h = 60 * (((g - b) / chroma) % 6);
    else if (max === g) h = 60 * ((b - r) / chroma + 2);
    else h = 60 * ((r - g) / chroma + 4);
  }

  return {
    h: wrapHue(h),
    s: max === 0 ? 0 : (chroma / max) * 100,
    v: max * 100,
  };
}

export function hsvaToRgb(value: Hsva): Rgb {
  return hsvToRgb(value.h, value.s, value.v);
}

export function rgbToHex(rgb: Rgb) {
  return `#${rgb.map((component) => clamp(Math.round(component), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The control's form value. `rgba()` whenever an opacity channel is in play and
 * below full, otherwise hex or `rgb()` per `format` (specs/color-encoder.md,
 * "Form submission").
 */
export function hsvaToFormValue(value: Hsva, format: "hex" | "rgb", withAlpha: boolean) {
  const rgb = hsvaToRgb(value);
  if (withAlpha && value.a < 100) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(value.a / 100).toFixed(3)})`;
  }
  return format === "rgb" ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : rgbToHex(rgb);
}

/** CSS colour for the ring: the selected colour at its selected opacity. */
export function hsvaToCss(value: Hsva) {
  const rgb = hsvaToRgb(value);
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(value.a / 100).toFixed(3)})`;
}

/**
 * Reads a stored theme colour as HSVA.
 *
 * Derived from the stored rgb and intensity rather than the stored cursor, so
 * every colour that exists today reads back exactly the colour it renders as.
 */
export function hsvaFromThemeColor(value: ThemeColorValue, opacity?: number): Hsva {
  const { h, s, v } = rgbToHsv(value.rgb);
  const intensity = clamp(Number.isFinite(value.intensity) ? value.intensity : 100, 0, 100);
  return {
    h,
    s,
    v: clamp((v * intensity) / 100, 0, 100),
    a: clamp(Number.isFinite(opacity) ? Number(opacity) : 100, 0, 100),
  };
}

/**
 * Writes HSVA back into a stored theme colour, preserving any sibling fields on
 * the value it was given. `cursor` keeps being written so anything still
 * reading pad position keeps working, but it is no longer the source of truth.
 */
export function themeColorFromHsva(value: Hsva, base: ThemeColorValue): ThemeColorValue {
  const normalized = normalizeHsva(value);
  return {
    ...base,
    cursor: { x: normalized.h / 359, y: 1 - normalized.s / 100 },
    intensity: Math.round(normalized.v),
    rgb: hsvToRgb(normalized.h, normalized.s, 100),
  };
}
