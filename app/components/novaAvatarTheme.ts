"use client";

import { useCallback, useEffect, useState } from "react";
import { appliedThemeRgb, type ThemeColorValue } from "./accentColor";

export type NovaAvatarTheme = {
  gradientCenter: ThemeColorValue;
  gradientOuter: ThemeColorValue;
  lineColors: [ThemeColorValue, ThemeColorValue, ThemeColorValue];
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
  lineColors: [
    { cursor: { x: 0.63, y: 0 }, intensity: 100, rgb: [80, 130, 255] }, // blue
    { cursor: { x: 0.79, y: 0 }, intensity: 100, rgb: [180, 95, 240] }, // purple
    { cursor: { x: 0.53, y: 0 }, intensity: 100, rgb: [60, 220, 240] }, // cyan
  ],
};

const STORAGE_KEY = "nova.dashboard.novaAvatar.v1";
const CHANGE_EVENT = "nova-avatar-theme-change";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeColor(value: unknown, fallback: ThemeColorValue): ThemeColorValue {
  const v = (value ?? {}) as Partial<ThemeColorValue>;
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

export function normalizeNovaAvatarTheme(value: unknown): NovaAvatarTheme {
  const v = (value ?? {}) as Partial<NovaAvatarTheme>;
  const lines = Array.isArray(v.lineColors) ? v.lineColors : [];
  return {
    gradientCenter: normalizeColor(v.gradientCenter, DEFAULT_NOVA_AVATAR_THEME.gradientCenter),
    gradientOuter: normalizeColor(v.gradientOuter, DEFAULT_NOVA_AVATAR_THEME.gradientOuter),
    lineColors: [
      normalizeColor(lines[0], DEFAULT_NOVA_AVATAR_THEME.lineColors[0]),
      normalizeColor(lines[1], DEFAULT_NOVA_AVATAR_THEME.lineColors[1]),
      normalizeColor(lines[2], DEFAULT_NOVA_AVATAR_THEME.lineColors[2]),
    ],
  };
}

function readStoredTheme(): NovaAvatarTheme {
  if (typeof window === "undefined") return DEFAULT_NOVA_AVATAR_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOVA_AVATAR_THEME;
    return normalizeNovaAvatarTheme(JSON.parse(raw));
  } catch {
    return DEFAULT_NOVA_AVATAR_THEME;
  }
}

function writeStoredTheme(theme: NovaAvatarTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function useNovaAvatarTheme() {
  const [theme, setThemeState] = useState<NovaAvatarTheme>(DEFAULT_NOVA_AVATAR_THEME);

  useEffect(() => {
    const load = () => setThemeState(readStoredTheme());
    load();
    window.addEventListener("storage", load);
    window.addEventListener(CHANGE_EVENT, load);
    return () => {
      window.removeEventListener("storage", load);
      window.removeEventListener(CHANGE_EVENT, load);
    };
  }, []);

  const setTheme = useCallback((next: NovaAvatarTheme) => {
    const normalized = normalizeNovaAvatarTheme(next);
    setThemeState(normalized);
    writeStoredTheme(normalized);
  }, []);

  const resetTheme = useCallback(() => {
    setThemeState(DEFAULT_NOVA_AVATAR_THEME);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }
  }, []);

  return { theme, setTheme, resetTheme };
}

/** Resolves a stored color (cursor + intensity + rgb) to its applied rgb tuple. */
export function resolveColor(color: ThemeColorValue): [number, number, number] {
  return appliedThemeRgb(color);
}
