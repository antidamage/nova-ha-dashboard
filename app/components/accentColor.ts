"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeColorSlot = "accent" | "highlight";
export type ThemeTitleTone = "auto" | "light" | "dark";
export type RadarPaletteMode = "spectrum" | "custom";
export type MapThemeColorSlot = "base" | "water" | "land" | "buildingLow" | "buildingHigh" | "roads" | "labels" | "radarLow" | "radarHigh";

export type ThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

export type ThemeBorderValue = {
  color: ThemeColorValue;
  enabled: boolean;
  opacity: number;
};

export type DeviceTheme = Record<ThemeColorSlot, ThemeColorValue> & {
  autoFullscreenOnLoad: boolean;
  background: ThemeColorValue;
  border: ThemeBorderValue;
  map: Record<MapThemeColorSlot, ThemeColorValue>;
  radarOpacity: number;
  radarPaletteMode: RadarPaletteMode;
  titleTone: ThemeTitleTone;
};

type StoredMapTheme = Partial<Record<MapThemeColorSlot, Partial<ThemeColorValue>>> & {
  buildings?: Partial<ThemeColorValue>;
  majorRoads?: Partial<ThemeColorValue>;
  minorRoads?: Partial<ThemeColorValue>;
};

const THEME_STORAGE_KEY = "nova.dashboard.accent.v1";
const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
export const RADAR_OPACITY_DEFAULT = 100;
export const RADAR_OPACITY_MAX = 100;
export const RADAR_OPACITY_MIN = 0;

export const DEFAULT_THEME: DeviceTheme = {
  accent: {
    cursor: { x: 0.22, y: 0.0 },
    intensity: 100,
    rgb: [215, 255, 50],
  },
  highlight: {
    cursor: { x: 0.5, y: 0.0 },
    intensity: 100,
    rgb: [40, 243, 255],
  },
  autoFullscreenOnLoad: false,
  background: {
    cursor: { x: 0.55, y: 0.93 },
    intensity: 16,
    rgb: [231, 244, 250],
  },
  border: {
    color: {
      cursor: { x: 0.22, y: 0.0 },
      intensity: 100,
      rgb: [215, 255, 50],
    },
    enabled: false,
    opacity: 36,
  },
  map: {
    base: {
      cursor: { x: 0.55, y: 0.93 },
      intensity: 16,
      rgb: [231, 244, 250],
    },
    water: {
      cursor: { x: 0.55, y: 0.72 },
      intensity: 100,
      rgb: [191, 232, 255],
    },
    land: {
      cursor: { x: 0.55, y: 0.94 },
      intensity: 14,
      rgb: [217, 229, 229],
    },
    buildingLow: {
      cursor: { x: 0.22, y: 0.0 },
      intensity: 100,
      rgb: [215, 255, 50],
    },
    buildingHigh: {
      cursor: { x: 0.5, y: 1.0 },
      intensity: 100,
      rgb: [255, 255, 255],
    },
    roads: {
      cursor: { x: 0.22, y: 0.0 },
      intensity: 100,
      rgb: [215, 255, 50],
    },
    labels: {
      cursor: { x: 0.22, y: 0.0 },
      intensity: 100,
      rgb: [215, 255, 50],
    },
    radarLow: {
      cursor: { x: 0.5, y: 0.0 },
      intensity: 100,
      rgb: [40, 243, 255],
    },
    radarHigh: {
      cursor: { x: 0.5, y: 1.0 },
      intensity: 100,
      rgb: [255, 255, 255],
    },
  },
  radarOpacity: RADAR_OPACITY_DEFAULT,
  radarPaletteMode: "spectrum",
  titleTone: "auto",
};

function clamp(value: number, min: number, max: number) {
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

function normalizeColor(value: Partial<ThemeColorValue> | null | undefined, fallback: ThemeColorValue): ThemeColorValue {
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

function normalizeRadarPaletteMode(value: unknown): RadarPaletteMode {
  return value === "custom" ? "custom" : "spectrum";
}

export function normalizeRadarOpacity(value: unknown) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return RADAR_OPACITY_DEFAULT;
  }

  return clamp(Math.round(parsed), RADAR_OPACITY_MIN, RADAR_OPACITY_MAX);
}

function matchesThemeColor(value: Partial<ThemeColorValue> | null | undefined, expected: ThemeColorValue) {
  if (!value) {
    return false;
  }

  const normalized = normalizeColor(value, expected);
  return normalized.intensity === expected.intensity
    && normalized.rgb.every((part, index) => part === expected.rgb[index]);
}

function normalizeTheme(value: Partial<DeviceTheme & ThemeColorValue> | null | undefined): DeviceTheme {
  const storedAccent = value?.accent ?? (Array.isArray(value?.rgb) ? value : null);
  const titleTone = ["auto", "light", "dark"].includes(String(value?.titleTone))
    ? (value?.titleTone as ThemeTitleTone)
    : DEFAULT_THEME.titleTone;
  const borderValue = value?.border;
  const mapValue = value?.map as StoredMapTheme | null | undefined;
  const buildingLowValue = mapValue?.buildingLow ?? mapValue?.buildings;
  const buildingHighValue = matchesThemeColor(mapValue?.buildingHigh, {
    cursor: { x: 0.5, y: 0.0 },
    intensity: 100,
    rgb: [40, 243, 255],
  }) ? undefined : mapValue?.buildingHigh;
  const waterValue = matchesThemeColor(mapValue?.water, {
    cursor: { x: 0.55, y: 0.94 },
    intensity: 12,
    rgb: [217, 233, 242],
  }) ? undefined : mapValue?.water;
  const roadsValue = mapValue?.roads ?? mapValue?.majorRoads ?? mapValue?.minorRoads;

  return {
    accent: normalizeColor(storedAccent, DEFAULT_THEME.accent),
    highlight: normalizeColor(value?.highlight, DEFAULT_THEME.highlight),
    autoFullscreenOnLoad: value?.autoFullscreenOnLoad === true,
    background: normalizeColor(value?.background, DEFAULT_THEME.background),
    border: {
      color: normalizeColor(borderValue?.color, DEFAULT_THEME.border.color),
      enabled: borderValue?.enabled === true,
      opacity: clamp(Math.round(Number(borderValue?.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
    },
    map: {
      base: normalizeColor(mapValue?.base, DEFAULT_THEME.map.base),
      water: normalizeColor(waterValue, DEFAULT_THEME.map.water),
      land: normalizeColor(mapValue?.land, DEFAULT_THEME.map.land),
      buildingLow: normalizeColor(buildingLowValue, DEFAULT_THEME.map.buildingLow),
      buildingHigh: normalizeColor(buildingHighValue, DEFAULT_THEME.map.buildingHigh),
      roads: normalizeColor(roadsValue, DEFAULT_THEME.map.roads),
      labels: normalizeColor(mapValue?.labels, DEFAULT_THEME.map.labels),
      radarLow: normalizeColor(mapValue?.radarLow, DEFAULT_THEME.map.radarLow),
      radarHigh: normalizeColor(mapValue?.radarHigh, DEFAULT_THEME.map.radarHigh),
    },
    radarOpacity: normalizeRadarOpacity(value?.radarOpacity),
    radarPaletteMode: normalizeRadarPaletteMode(value?.radarPaletteMode),
    titleTone,
  };
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

function applyCssColor(name: "line" | "cyan", rgb: [number, number, number]) {
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  if (name === "line") {
    root.style.setProperty("--foreground", `rgb(${value})`);
    root.style.setProperty("--cyber-line", `rgb(${value})`);
    root.style.setProperty("--cyber-line-rgb", value);
    root.style.setProperty("--cyber-line-dim", `rgb(${value} / 0.36)`);
    return;
  }

  root.style.setProperty("--cyber-cyan", `rgb(${value})`);
  root.style.setProperty("--cyber-cyan-rgb", value);
}

function applyCssBorder(border: ThemeBorderValue, fallbackRgb: [number, number, number]) {
  const normalizedBorder = {
    color: normalizeColor(border.color, DEFAULT_THEME.border.color),
    enabled: border.enabled === true,
    opacity: clamp(Math.round(Number(border.opacity ?? DEFAULT_THEME.border.opacity)), 0, 100),
  };
  const rgb = normalizedBorder.enabled ? appliedThemeRgb(normalizedBorder.color) : fallbackRgb;
  const opacity = normalizedBorder.enabled ? normalizedBorder.opacity / 100 : 0.36;
  const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
  const root = document.documentElement;

  root.style.setProperty("--cyber-border-rgb", value);
  root.style.setProperty("--cyber-border-dim", `rgb(${value} / ${opacity})`);
  root.style.setProperty("--cyber-border-strong", `rgb(${value} / ${Math.min(1, opacity + 0.54)})`);
}

function mixRgb(from: [number, number, number], to: [number, number, number], amount: number): [number, number, number] {
  return [
    clamp(Math.round(from[0] + (to[0] - from[0]) * amount), 0, 255),
    clamp(Math.round(from[1] + (to[1] - from[1]) * amount), 0, 255),
    clamp(Math.round(from[2] + (to[2] - from[2]) * amount), 0, 255),
  ];
}

function rgbCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

function applyCssBackground(rgb: [number, number, number]) {
  const root = document.documentElement;
  root.style.setProperty("--background", rgbCss(rgb));
  root.style.setProperty("--cyber-bg", rgbCss(rgb));
  root.style.setProperty("--cyber-panel", rgbCss(mixRgb(rgb, [0, 0, 0], 0.16)));
  root.style.setProperty("--cyber-panel-soft", rgbCss(mixRgb(rgb, [255, 255, 255], 0.07)));
}

function luminance(rgb: [number, number, number]) {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function titleColorFor(tone: ThemeTitleTone, rgb: [number, number, number], allowOverride: boolean) {
  if (!allowOverride) {
    return luminance(rgb) > 0.5 ? "var(--cyber-title-dark)" : "var(--cyber-title-light)";
  }
  if (tone === "dark") {
    return "var(--cyber-title-dark)";
  }
  if (tone === "light") {
    return "var(--cyber-title-light)";
  }

  return luminance(rgb) > 0.5 ? "var(--cyber-title-dark)" : "var(--cyber-title-light)";
}

function applyCssTitleTone(tone: ThemeTitleTone, accent: [number, number, number], highlight: [number, number, number], background: [number, number, number]) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-title-on-line", titleColorFor(tone, accent, false));
  root.style.setProperty("--cyber-title-on-cyan", titleColorFor(tone, highlight, false));
  root.style.setProperty("--cyber-title-on-bg", titleColorFor(tone, background, true));
}

function applyCssMap(map: DeviceTheme["map"]) {
  const root = document.documentElement;
  const setMapColor = (name: string, color: ThemeColorValue) => {
    const rgb = appliedThemeRgb(color);
    const value = `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
    root.style.setProperty(`--cyber-map-${name}`, `rgb(${value})`);
    root.style.setProperty(`--cyber-map-${name}-rgb`, value);
  };

  setMapColor("base", map.base);
  setMapColor("water", map.water);
  setMapColor("land", map.land);
  setMapColor("building-low", map.buildingLow);
  setMapColor("building-high", map.buildingHigh);
  setMapColor("roads", map.roads);
  setMapColor("labels", map.labels);
  setMapColor("radar-low", map.radarLow);
  setMapColor("radar-high", map.radarHigh);
}

function applyCssRadarOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-radar-opacity", String(normalizeRadarOpacity(value)));
}

export function applyDeviceTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  const accent = appliedThemeRgb(normalized.accent);
  const highlight = appliedThemeRgb(normalized.highlight);
  const background = appliedThemeRgb(normalized.background);

  applyCssColor("line", accent);
  applyCssColor("cyan", highlight);
  applyCssBorder(normalized.border, accent);
  applyCssBackground(background);
  applyCssTitleTone(normalized.titleTone, accent, highlight, background);
  applyCssMap(normalized.map);
  applyCssRadarOpacity(normalized.radarOpacity);
  document.documentElement.style.setProperty("--cyber-map-radar-mode", normalized.radarPaletteMode);
}

function readTheme(fallback: Partial<DeviceTheme & ThemeColorValue> | null | undefined = DEFAULT_THEME) {
  if (typeof window === "undefined") {
    return normalizeTheme(fallback);
  }

  try {
    return normalizeTheme(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "null") ?? fallback);
  } catch {
    return normalizeTheme(fallback);
  }
}

function writeThemeCookie(theme: DeviceTheme) {
  window.document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(normalizeTheme(theme)))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function removeThemeCookie() {
  window.document.cookie = `${THEME_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function writeTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized));
  writeThemeCookie(normalized);
  window.dispatchEvent(new CustomEvent("nova-accent-change"));
}

export function useDeviceTheme(initialTheme?: Partial<DeviceTheme & ThemeColorValue> | null) {
  const [theme, setThemeState] = useState(() => normalizeTheme(initialTheme ?? DEFAULT_THEME));
  const [themeReady, setThemeReady] = useState(initialTheme != null);

  useEffect(() => {
    const load = () => {
      const next = readTheme(initialTheme ?? DEFAULT_THEME);
      setThemeState(next);
      applyDeviceTheme(next);
      writeThemeCookie(next);
      setThemeReady(true);
    };

    load();
    window.addEventListener("storage", load);
    window.addEventListener("nova-accent-change", load);

    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener("nova-accent-change", load);
    };
  }, []);

  const setTheme = useCallback((next: DeviceTheme) => {
    const normalized = normalizeTheme(next);
    setThemeState(normalized);
    applyDeviceTheme(normalized);
    writeTheme(normalized);
  }, []);

  const setThemeColor = useCallback(
    (slot: ThemeColorSlot | "background", value: ThemeColorValue) => {
      setTheme({ ...theme, [slot]: value });
    },
    [setTheme, theme],
  );

  const resetTheme = useCallback(() => {
    setThemeState(DEFAULT_THEME);
    setThemeReady(true);
    applyDeviceTheme(DEFAULT_THEME);
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    removeThemeCookie();
    window.dispatchEvent(new CustomEvent("nova-accent-change"));
  }, []);

  return { resetTheme, setTheme, setThemeColor, theme, themeReady };
}
