"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeColorSlot = "accent" | "highlight";
export type ThemeTitleTone = "auto" | "light" | "dark";

export type ThemeColorValue = {
  cursor: { x: number; y: number };
  intensity: number;
  rgb: [number, number, number];
};

export type DeviceTheme = Record<ThemeColorSlot, ThemeColorValue> & {
  background: ThemeColorValue;
  titleTone: ThemeTitleTone;
};

const THEME_STORAGE_KEY = "nova.dashboard.accent.v1";
const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";

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
  background: {
    cursor: { x: 0.55, y: 0.93 },
    intensity: 16,
    rgb: [231, 244, 250],
  },
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

function normalizeTheme(value: Partial<DeviceTheme & ThemeColorValue> | null | undefined): DeviceTheme {
  const storedAccent = value?.accent ?? (Array.isArray(value?.rgb) ? value : null);
  const titleTone = ["auto", "light", "dark"].includes(String(value?.titleTone))
    ? (value?.titleTone as ThemeTitleTone)
    : DEFAULT_THEME.titleTone;

  return {
    accent: normalizeColor(storedAccent, DEFAULT_THEME.accent),
    highlight: normalizeColor(value?.highlight, DEFAULT_THEME.highlight),
    background: normalizeColor(value?.background, DEFAULT_THEME.background),
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

export function applyDeviceTheme(theme: DeviceTheme) {
  const normalized = normalizeTheme(theme);
  const accent = appliedThemeRgb(normalized.accent);
  const highlight = appliedThemeRgb(normalized.highlight);
  const background = appliedThemeRgb(normalized.background);

  applyCssColor("line", accent);
  applyCssColor("cyan", highlight);
  applyCssBackground(background);
  applyCssTitleTone(normalized.titleTone, accent, highlight, background);
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
