"use client";

// Pure colour maths: clamping, HSL, intensity, title-tone choice, blending.
import { PANEL_SEED_INTENSITY_RATIO } from "./constants";
import { DEFAULT_THEME } from "./defaults";
import type { DeviceTheme, ThemeColorValue, ThemeTitleColors, ThemeTitleTone } from "./types";

export function clamp(value: number, min: number, max: number) {
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

export function normalizeColor(value: Partial<ThemeColorValue> | null | undefined, fallback: ThemeColorValue): ThemeColorValue {
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

export function rgbCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function panelColorSeedFromBackground(background: ThemeColorValue): ThemeColorValue {
  return {
    cursor: { ...background.cursor },
    intensity: clamp(Math.round(background.intensity * PANEL_SEED_INTENSITY_RATIO), 0, 100),
    rgb: [...background.rgb] as [number, number, number],
  };
}

function luminance(rgb: [number, number, number]) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

type ThemeTitleColorSlot = keyof ThemeTitleColors;

export function titleColorSlotFor(tone: ThemeTitleTone, rgb: [number, number, number], allowOverride: boolean): ThemeTitleColorSlot {
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

export function titleColorFor(tone: ThemeTitleTone, rgb: [number, number, number], allowOverride: boolean) {
  return `var(--cyber-title-${titleColorSlotFor(tone, rgb, allowOverride)})`;
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
    headerFade: { ...configured.headerFade, color: color(configured.headerFade.color, target.headerFade.color) },
    panel: { ...configured.panel, color: color(configured.panel.color, target.panel.color) },
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
