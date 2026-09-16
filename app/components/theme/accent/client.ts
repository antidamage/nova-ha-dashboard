"use client";

// Outbound calls: /api/theme (read and write) and /api/state (sun status).
import { DEFAULT_THEME_SET } from "./defaults";
import { normalizeTheme, normalizeThemeSet } from "./theme-model";
import type { DeviceThemeSet, SunThemeStatus, ThemeStorageValue } from "./types";

export async function readSharedThemeSet(fallback: ThemeStorageValue | null | undefined = DEFAULT_THEME_SET) {
  const response = await fetch("/api/theme", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Shared theme request failed: ${response.status}`);
  }

  const data = await response.json() as { theme?: ThemeStorageValue | null };
  return normalizeThemeSet(data.theme ?? fallback, fallback);
}

export async function readSunStatus() {
  const response = await fetch("/api/state", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Sun state request failed: ${response.status}`);
  }

  const data = await response.json() as { sun?: SunThemeStatus | null };
  return data.sun ?? null;
}

function sharedThemePayload(themeSet: DeviceThemeSet): Record<string, unknown> {
  const normalized = normalizeThemeSet(themeSet);
  return {
    selection: normalized.selection,
    themes: {
      dark: normalizeTheme(normalized.themes.dark),
      light: normalizeTheme(normalized.themes.light),
    },
  };
}

export async function writeSharedTheme(themeSet: DeviceThemeSet): Promise<DeviceThemeSet> {
  const normalized = normalizeThemeSet(themeSet);
  const response = await fetch("/api/theme", {
    body: JSON.stringify({ theme: sharedThemePayload(normalized) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Shared theme update failed: ${response.status}`);
  }

  const data = await response.json() as { theme?: ThemeStorageValue | null };
  return normalizeThemeSet(data.theme ?? sharedThemePayload(normalized), normalized);
}
