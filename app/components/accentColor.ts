"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeColorSlot = "accent" | "highlight";
export type ThemeConfigScope = "local" | "shared";
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

export type ThemeMapLayerValue = {
  enabled: boolean;
  opacity: number;
};

export type DeviceTheme = Record<ThemeColorSlot, ThemeColorValue> & {
  autoFullscreenOnLoad: boolean;
  background: ThemeColorValue;
  border: ThemeBorderValue;
  map: Record<MapThemeColorSlot, ThemeColorValue>;
  mapBuildingOpacity: number;
  mapLabelSize: number;
  mapSatellite: boolean;
  mapWater: ThemeMapLayerValue;
  radarOpacity: number;
  radarPaletteMode: RadarPaletteMode;
  taskGlowIntensity: number;
  titleTone: ThemeTitleTone;
};

type StoredMapTheme = Partial<Record<MapThemeColorSlot, Partial<ThemeColorValue>>> & {
  buildings?: Partial<ThemeColorValue>;
  majorRoads?: Partial<ThemeColorValue>;
  minorRoads?: Partial<ThemeColorValue>;
};

const THEME_STORAGE_KEY = "nova.dashboard.accent.v1";
const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
const THEME_SCOPE_STORAGE_KEY = "nova.dashboard.configScope.v1";
const THEME_SCOPE_COOKIE_NAME = "nova.dashboard.configScope.v1";
const THEME_CHANGE_EVENT = "nova-accent-change";
const THEME_SCOPE_CHANGE_EVENT = "nova-config-scope-change";
const SHARED_THEME_POLL_MS = 30 * 1000;
export const RADAR_OPACITY_DEFAULT = 100;
export const RADAR_OPACITY_MAX = 100;
export const RADAR_OPACITY_MIN = 0;
export const MAP_LABEL_SIZE_DEFAULT = 100;
export const MAP_LABEL_SIZE_MAX = 200;
export const MAP_LABEL_SIZE_MIN = 50;
export const MAP_BUILDING_OPACITY_DEFAULT = 38;
export const MAP_BUILDING_OPACITY_MAX = 100;
export const MAP_BUILDING_OPACITY_MIN = 0;
export const TASK_GLOW_INTENSITY_DEFAULT = 200;
export const TASK_GLOW_INTENSITY_MAX = 300;
export const TASK_GLOW_INTENSITY_MIN = 50;

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
  mapBuildingOpacity: MAP_BUILDING_OPACITY_DEFAULT,
  mapLabelSize: MAP_LABEL_SIZE_DEFAULT,
  mapSatellite: true,
  mapWater: {
    enabled: true,
    opacity: 100,
  },
  radarOpacity: RADAR_OPACITY_DEFAULT,
  radarPaletteMode: "spectrum",
  taskGlowIntensity: TASK_GLOW_INTENSITY_DEFAULT,
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

function normalizeThemeScope(value: unknown): ThemeConfigScope {
  return value === "shared" ? "shared" : "local";
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(Math.round(parsed), min, max);
}

function normalizePercent(value: unknown, fallback: number) {
  return normalizeNumber(value, fallback, 0, 100);
}

function normalizeMapLabelSize(value: unknown) {
  return normalizeNumber(value, MAP_LABEL_SIZE_DEFAULT, MAP_LABEL_SIZE_MIN, MAP_LABEL_SIZE_MAX);
}

function normalizeMapBuildingOpacity(value: unknown) {
  return normalizeNumber(value, MAP_BUILDING_OPACITY_DEFAULT, MAP_BUILDING_OPACITY_MIN, MAP_BUILDING_OPACITY_MAX);
}

export function normalizeRadarOpacity(value: unknown) {
  return normalizePercent(value, RADAR_OPACITY_DEFAULT);
}

export function normalizeTaskGlowIntensity(value: unknown) {
  return normalizeNumber(value, TASK_GLOW_INTENSITY_DEFAULT, TASK_GLOW_INTENSITY_MIN, TASK_GLOW_INTENSITY_MAX);
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
  const mapWaterValue = value?.mapWater;
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
    mapBuildingOpacity: normalizeMapBuildingOpacity(value?.mapBuildingOpacity),
    mapLabelSize: normalizeMapLabelSize(value?.mapLabelSize),
    mapSatellite: value?.mapSatellite !== false,
    mapWater: {
      enabled: mapWaterValue?.enabled !== false,
      opacity: normalizePercent(mapWaterValue?.opacity, DEFAULT_THEME.mapWater.opacity),
    },
    radarOpacity: normalizeRadarOpacity(value?.radarOpacity),
    radarPaletteMode: normalizeRadarPaletteMode(value?.radarPaletteMode),
    taskGlowIntensity: normalizeTaskGlowIntensity(value?.taskGlowIntensity),
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
  root.style.setProperty("--cyber-highlight", `rgb(${value})`);
  root.style.setProperty("--cyber-highlight-rgb", value);
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
  root.style.setProperty("--cyber-title-on-highlight", titleColorFor(tone, highlight, false));
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

function applyCssMapWater(water: ThemeMapLayerValue) {
  const root = document.documentElement;
  root.style.setProperty("--cyber-map-water-enabled", water.enabled ? "1" : "0");
  root.style.setProperty("--cyber-map-water-opacity", String(normalizePercent(water.opacity, DEFAULT_THEME.mapWater.opacity)));
}

function applyCssMapLabelSize(value: number) {
  document.documentElement.style.setProperty("--cyber-map-label-size", String(normalizeMapLabelSize(value)));
}

function applyCssMapBuildingOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-building-opacity", String(normalizeMapBuildingOpacity(value)));
}

function applyCssRadarOpacity(value: number) {
  document.documentElement.style.setProperty("--cyber-map-radar-opacity", String(normalizeRadarOpacity(value)));
}

function applyCssTaskGlowIntensity(value: number) {
  const intensity = normalizeTaskGlowIntensity(value);
  const scale = intensity / 100;
  const root = document.documentElement;

  root.style.setProperty("--task-glow-intensity", String(intensity));
  root.style.setProperty("--task-glow-cyan-blur", `${Math.round(128 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-spread", `${Math.round(42 * scale)}px`);
  root.style.setProperty("--task-glow-line-blur", `${Math.round(72 * scale)}px`);
  root.style.setProperty("--task-glow-line-spread", `${Math.round(18 * scale)}px`);
  root.style.setProperty("--task-glow-cyan-alpha", Math.min(1, 0.7 * scale).toFixed(3));
  root.style.setProperty("--task-glow-line-alpha", Math.min(1, 0.72 * scale).toFixed(3));
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
  applyCssMapBuildingOpacity(normalized.mapBuildingOpacity);
  applyCssMapLabelSize(normalized.mapLabelSize);
  applyCssMapWater(normalized.mapWater);
  applyCssRadarOpacity(normalized.radarOpacity);
  applyCssTaskGlowIntensity(normalized.taskGlowIntensity);
  document.documentElement.style.setProperty("--cyber-map-radar-mode", normalized.radarPaletteMode);
  document.documentElement.style.setProperty("--cyber-map-satellite", normalized.mapSatellite ? "1" : "0");
}

function cookieValue(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? null;
}

function readThemeScope() {
  if (typeof window === "undefined") {
    return "local" as ThemeConfigScope;
  }

  try {
    return normalizeThemeScope(window.localStorage.getItem(THEME_SCOPE_STORAGE_KEY) ?? cookieValue(THEME_SCOPE_COOKIE_NAME));
  } catch {
    return normalizeThemeScope(cookieValue(THEME_SCOPE_COOKIE_NAME));
  }
}

function writeThemeScopeCookie(scope: ThemeConfigScope) {
  window.document.cookie = `${THEME_SCOPE_COOKIE_NAME}=${scope}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function writeThemeScope(scope: ThemeConfigScope) {
  const normalized = normalizeThemeScope(scope);
  window.localStorage.setItem(THEME_SCOPE_STORAGE_KEY, normalized);
  writeThemeScopeCookie(normalized);
}

function readLocalTheme(fallback: Partial<DeviceTheme & ThemeColorValue> | null | undefined = DEFAULT_THEME) {
  if (typeof window === "undefined") {
    return normalizeTheme(fallback);
  }

  try {
    return normalizeTheme(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "null") ?? fallback);
  } catch {
    return normalizeTheme(fallback);
  }
}

function readLocalAutoFullscreen() {
  if (typeof window === "undefined") {
    return DEFAULT_THEME.autoFullscreenOnLoad;
  }

  try {
    return normalizeTheme(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? "null") ?? DEFAULT_THEME).autoFullscreenOnLoad;
  } catch {
    return DEFAULT_THEME.autoFullscreenOnLoad;
  }
}

function withLocalAutoFullscreen(theme: DeviceTheme) {
  return {
    ...theme,
    autoFullscreenOnLoad: readLocalAutoFullscreen(),
  };
}

async function readSharedTheme(fallback: Partial<DeviceTheme & ThemeColorValue> | null | undefined = DEFAULT_THEME) {
  const response = await fetch("/api/theme", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Shared theme request failed: ${response.status}`);
  }

  const data = await response.json() as { theme?: Partial<DeviceTheme & ThemeColorValue> | null };
  return withLocalAutoFullscreen(normalizeTheme(data.theme ?? fallback));
}

function writeThemeCookie(theme: DeviceTheme) {
  window.document.cookie = `${THEME_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(normalizeTheme(theme)))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function removeThemeCookie() {
  window.document.cookie = `${THEME_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function writeLocalTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized));
  writeThemeCookie(normalized);
}

function writeLocalAutoFullscreen(autoFullscreenOnLoad: boolean) {
  const normalized = normalizeTheme({
    ...readLocalTheme(DEFAULT_THEME),
    autoFullscreenOnLoad,
  });
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(normalized));
}

function sharedThemePayload(theme: DeviceTheme): Record<string, unknown> {
  const { autoFullscreenOnLoad: _localOnly, ...sharedTheme } = normalizeTheme(theme);
  return sharedTheme;
}

async function writeSharedTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  const response = await fetch("/api/theme", {
    body: JSON.stringify({ theme: sharedThemePayload(normalized) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Shared theme update failed: ${response.status}`);
  }
}

export function useDeviceTheme(initialTheme?: Partial<DeviceTheme & ThemeColorValue> | null) {
  const [themeScope, setThemeScopeState] = useState<ThemeConfigScope>(() => readThemeScope());
  const [theme, setThemeState] = useState(() => normalizeTheme(initialTheme ?? DEFAULT_THEME));
  const [themeReady, setThemeReady] = useState(initialTheme != null);

  const loadTheme = useCallback(async (requestedScope: ThemeConfigScope = readThemeScope()) => {
    const nextScope = normalizeThemeScope(requestedScope);
    const fallback = initialTheme ?? DEFAULT_THEME;
    setThemeScopeState(nextScope);

    try {
      const nextTheme = nextScope === "shared"
        ? await readSharedTheme(fallback)
        : readLocalTheme(fallback);
      setThemeState(nextTheme);
      applyDeviceTheme(nextTheme);
      writeThemeCookie(nextTheme);
      writeThemeScopeCookie(nextScope);
      setThemeReady(true);
      window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
    } catch (error) {
      console.error("[nova-dashboard] failed to load dashboard theme", error);
      setThemeReady(true);
    }
  }, [initialTheme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== THEME_STORAGE_KEY && event.key !== THEME_SCOPE_STORAGE_KEY) {
        return;
      }

      void loadTheme();
    };
    const onScopeChange = () => void loadTheme();

    void loadTheme();
    window.addEventListener("storage", onStorage);
    window.addEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(THEME_SCOPE_CHANGE_EVENT, onScopeChange);
    };
  }, [loadTheme]);

  useEffect(() => {
    if (themeScope !== "shared") {
      return;
    }

    const interval = window.setInterval(() => {
      void loadTheme("shared");
    }, SHARED_THEME_POLL_MS);

    return () => window.clearInterval(interval);
  }, [loadTheme, themeScope]);

  const setTheme = useCallback((next: DeviceTheme) => {
    const normalized = normalizeTheme(next);
    setThemeState(normalized);
    applyDeviceTheme(normalized);
    writeThemeCookie(normalized);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));

    if (themeScope === "shared") {
      writeLocalAutoFullscreen(normalized.autoFullscreenOnLoad);
      void writeSharedTheme(normalized).catch((error) => {
        console.error("[nova-dashboard] failed to update shared dashboard theme", error);
      });
      return;
    }

    writeLocalTheme(normalized);
  }, [themeScope]);

  const setThemeScope = useCallback((nextScope: ThemeConfigScope) => {
    const normalized = normalizeThemeScope(nextScope);
    writeThemeScope(normalized);
    setThemeScopeState(normalized);
    window.dispatchEvent(new CustomEvent(THEME_SCOPE_CHANGE_EVENT));
    void loadTheme(normalized);
  }, [loadTheme]);

  const setThemeColor = useCallback(
    (slot: ThemeColorSlot | "background", value: ThemeColorValue) => {
      setTheme({ ...theme, [slot]: value });
    },
    [setTheme, theme],
  );

  const resetTheme = useCallback(() => {
    const nextTheme = themeScope === "shared"
      ? { ...DEFAULT_THEME, autoFullscreenOnLoad: readLocalAutoFullscreen() }
      : DEFAULT_THEME;

    setThemeState(nextTheme);
    setThemeReady(true);
    applyDeviceTheme(nextTheme);
    writeThemeCookie(nextTheme);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));

    if (themeScope === "shared") {
      void writeSharedTheme(nextTheme).catch((error) => {
        console.error("[nova-dashboard] failed to reset shared dashboard theme", error);
      });
      return;
    }

    window.localStorage.removeItem(THEME_STORAGE_KEY);
    removeThemeCookie();
  }, [themeScope]);

  return { resetTheme, setTheme, setThemeColor, setThemeScope, theme, themeReady, themeScope };
}
