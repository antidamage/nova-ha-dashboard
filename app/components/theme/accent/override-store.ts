"use client";

// The per-device theme override's storage (specs/theme-override.md). Moved out
// of store.ts as is; store.ts re-exports both functions.
import { THEME_OVERRIDE_CHANGE_EVENT, THEME_OVERRIDE_STORAGE_KEY } from "./constants";
import { readThemeOverridePreview } from "./override-preview";
import { normalizeThemeOverride } from "./variant-model";
import type { ThemeOverride } from "./types";

/** The override in force: the tour's preview while it is set, else the stored one. */
export function readThemeOverride(): ThemeOverride {
  const preview = readThemeOverridePreview();
  if (preview) return preview;
  if (typeof window === "undefined") return "unset";
  try {
    return normalizeThemeOverride(window.localStorage.getItem(THEME_OVERRIDE_STORAGE_KEY));
  } catch {
    return "unset";
  }
}

export function writeThemeOverride(next: ThemeOverride) {
  if (typeof window === "undefined") return;
  const normalized = normalizeThemeOverride(next);
  try {
    if (normalized === "unset") {
      window.localStorage.removeItem(THEME_OVERRIDE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_OVERRIDE_STORAGE_KEY, normalized);
    }
  } catch {
    // Storage blocked: the change still applies for this page view.
  }
  window.dispatchEvent(new CustomEvent(THEME_OVERRIDE_CHANGE_EVENT, { detail: normalized }));
}
