"use client";

// Which variant (dark/light) applies: the sun, the global selection, and the
// per-device override.
import { THEME_OVERRIDE_CYCLE } from "./constants";
import { normalizeThemeSet } from "./theme-model";
import type { DeviceThemeSet, SunThemeStatus, ThemeOverride, ThemeSelection, ThemeVariant } from "./types";

function sunStatusIsDark(sun?: SunThemeStatus | null) {
  if (sun?.state === "below_horizon") {
    return true;
  }
  if (sun?.state === "above_horizon") {
    return false;
  }

  const nextRising = Date.parse(String(sun?.nextRising ?? ""));
  const nextSetting = Date.parse(String(sun?.nextSetting ?? ""));
  if (Number.isFinite(nextRising) && Number.isFinite(nextSetting)) {
    return nextRising < nextSetting;
  }

  const hour = new Date().getHours();
  return hour < 6 || hour >= 18;
}

export function resolveThemeVariant(selection: ThemeSelection, sun?: SunThemeStatus | null): ThemeVariant {
  if (selection === "dark" || selection === "light") {
    return selection;
  }
  return sunStatusIsDark(sun) ? "dark" : "light";
}

// ---- Per-device theme override (specs/theme-override.md) ------------------
// A local layer over the global ThemeSelection. "unset" means no key stored and
// the global selection applies. Never written to the server or global settings.

export function normalizeThemeOverride(value: unknown): ThemeOverride {
  return value === "auto" || value === "light" || value === "dark" ? value : "unset";
}

export function nextThemeOverride(current: ThemeOverride): ThemeOverride {
  const index = THEME_OVERRIDE_CYCLE.indexOf(normalizeThemeOverride(current));
  return THEME_OVERRIDE_CYCLE[(index + 1) % THEME_OVERRIDE_CYCLE.length];
}

export function effectiveThemeSelection(global: ThemeSelection, override: ThemeOverride | null | undefined): ThemeSelection {
  const normalized = normalizeThemeOverride(override);
  return normalized === "unset" ? global : normalized;
}

export function resolveDeviceTheme(
  themeSet: DeviceThemeSet,
  sun?: SunThemeStatus | null,
  override?: ThemeOverride | null,
) {
  const normalized = normalizeThemeSet(themeSet);
  const activeVariant = resolveThemeVariant(effectiveThemeSelection(normalized.selection, override), sun);
  return {
    activeVariant,
    theme: normalized.themes[activeVariant],
  };
}
