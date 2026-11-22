"use client";

// The tour's preview of the per-device override (specs/theme-override.md, "Tour
// preview"; specs/tutorial-mode.md, "Light and dark"). Held in memory only: it
// is never written to localStorage, so no other instance sees a storage event,
// and the override event's handler re-applies the theme without broadcasting
// or persisting it. A reload clears it.
import { THEME_OVERRIDE_CHANGE_EVENT } from "./constants";
import type { ThemeOverride } from "./types";

let preview: ThemeOverride | null = null;

export function readThemeOverridePreview(): ThemeOverride | null {
  return preview;
}

/** Sets the preview, or clears it with null; the page re-themes at once. */
export function setThemeOverridePreview(next: ThemeOverride | null) {
  if (preview === next) return;
  preview = next;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_OVERRIDE_CHANGE_EVENT, { detail: next }));
}
