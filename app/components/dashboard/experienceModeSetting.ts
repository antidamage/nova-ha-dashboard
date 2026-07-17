"use client";

import { useCallback, useEffect, useState } from "react";

// The experience mode is a per-device preference controlling the four heavy
// visual features — the status orb, the animated WebGL background, the live
// camera, and the live world map — plus the global CSS kill-switch. It never
// travels with a theme and is never written to the shared host config.
//
// Historically this was a single "rich" | "lite" switch. It is now four
// independent per-feature toggles (see ExperienceFeatures) so a device can,
// say, keep the status orb but drop the WebGL background. The first-run modal
// (ExperienceModeModal) still offers the two coarse choices — "Full Experience"
// turns everything on, "Lite" turns everything off — and the /config "This
// Device" section exposes the four toggles individually.
//
// Storage stays on one key and one backward-compatible format:
//   - "rich"  → all four features on   (canonical all-on)
//   - "lite"  → all four features off  (canonical all-off)
//   - a JSON  {statusOrb,background,camera,worldMap} object for mixed states
//   - absent/invalid → undecided (first-run modal prompts once)
// The legacy strings are still emitted for the two extremes so old readers,
// the e2e seed helpers, and the pre-paint bootstrap keep working unchanged.
//
// The head bootstrap in app/layout.tsx mirrors this key before first paint,
// setting `data-nova-lite` (all four off → the CSS kill-switch in globals.css)
// and `data-nova-no-orb` (status orb off → pre-paint orb suppression). CSS
// animations/transitions/backdrop-filters are neutralised automatically in
// full lite; JS-driven work (rAF loops, canvas/WebGL, polling, media playback)
// is NOT auto-covered and must gate itself on the relevant feature via
// useExperienceFeature() / readExperienceFeatures() (or useLiteMode() for the
// all-off pathway). See SPEC.md "Experience Modes" and docs/lite-mode.md
// before adding any new visual or costly feature.
export type ExperienceMode = "rich" | "lite";

export type ExperienceFeatureKey = "statusOrb" | "background" | "camera" | "worldMap";
export type ExperienceFeatures = Record<ExperienceFeatureKey, boolean>;

export const EXPERIENCE_FEATURE_KEYS: readonly ExperienceFeatureKey[] = [
  "statusOrb",
  "background",
  "camera",
  "worldMap",
];

const ALL_ON: ExperienceFeatures = { statusOrb: true, background: true, camera: true, worldMap: true };
const ALL_OFF: ExperienceFeatures = { statusOrb: false, background: false, camera: false, worldMap: false };

const EXPERIENCE_MODE_STORAGE_KEY = "nova.dashboard.experienceMode.v1";
const EXPERIENCE_MODE_CHANGE_EVENT = "nova-experience-mode-change";

export { EXPERIENCE_MODE_STORAGE_KEY };

function everyFeatureIs(features: ExperienceFeatures, value: boolean): boolean {
  return EXPERIENCE_FEATURE_KEYS.every((key) => features[key] === value);
}

/** True when the device has opted out of every heavy feature (full lite). */
export function isLiteFeatures(features: ExperienceFeatures): boolean {
  return everyFeatureIs(features, false);
}

/**
 * Parse a raw stored value into a full features object, or null when the value
 * means "undecided" (absent/invalid). Accepts the canonical "rich"/"lite"
 * strings and the JSON object form; unknown keys are ignored and missing keys
 * default to on (the rich default) so a partial/tampered object never silently
 * hides a feature.
 */
function parseStoredFeatures(raw: string | null): ExperienceFeatures | null {
  if (raw === "rich") {
    return { ...ALL_ON };
  }
  if (raw === "lite") {
    return { ...ALL_OFF };
  }
  if (raw && raw.charAt(0) === "{") {
    try {
      const parsed = JSON.parse(raw) as Partial<Record<ExperienceFeatureKey, unknown>>;
      if (parsed && typeof parsed === "object") {
        return {
          statusOrb: parsed.statusOrb !== false,
          background: parsed.background !== false,
          camera: parsed.camera !== false,
          worldMap: parsed.worldMap !== false,
        };
      }
    } catch {
      // Fall through to undecided.
    }
  }
  return null;
}

/** Serialise to the most compact form: "rich"/"lite" for the extremes, JSON otherwise. */
function serialiseFeatures(features: ExperienceFeatures): string {
  if (everyFeatureIs(features, true)) {
    return "rich";
  }
  if (everyFeatureIs(features, false)) {
    return "lite";
  }
  return JSON.stringify(features);
}

/**
 * Raw stored features; null means the device has not decided yet (show the
 * first-run modal). Rendering paths should use readExperienceFeatures().
 */
export function readStoredExperienceFeatures(): ExperienceFeatures | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return parseStoredFeatures(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Resolved features for rendering: undecided devices render everything on (the
 * SSR default) behind the first-run modal until they choose.
 */
export function readExperienceFeatures(): ExperienceFeatures {
  return readStoredExperienceFeatures() ?? { ...ALL_ON };
}

/**
 * Raw stored coarse mode; null means undecided. Kept for the first-run modal
 * and legacy callers — a mixed feature set resolves to "rich".
 */
export function readStoredExperienceMode(): ExperienceMode | null {
  const features = readStoredExperienceFeatures();
  if (!features) {
    return null;
  }
  return isLiteFeatures(features) ? "lite" : "rich";
}

/** Resolved coarse mode for rendering; "lite" only when every feature is off. */
export function readExperienceModeSetting(): ExperienceMode {
  return isLiteFeatures(readExperienceFeatures()) ? "lite" : "rich";
}

function applyExperienceSideEffects(features: ExperienceFeatures) {
  // Keep the pre-paint CSS guards in step with the stored value so the next
  // load (and the current document) agree without waiting for hydration.
  document.documentElement.toggleAttribute("data-nova-lite", isLiteFeatures(features));
  document.documentElement.toggleAttribute("data-nova-no-orb", !features.statusOrb);
  window.dispatchEvent(new CustomEvent(EXPERIENCE_MODE_CHANGE_EVENT));
}

export function writeExperienceFeatures(features: ExperienceFeatures) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, serialiseFeatures(features));
  } catch {
    // Storage can be denied in private/restricted contexts; the in-page state still updates.
  }
  applyExperienceSideEffects(features);
}

/** Toggle one feature, preserving the others (undecided devices start from all-on). */
export function setExperienceFeature(key: ExperienceFeatureKey, value: boolean) {
  const base = readStoredExperienceFeatures() ?? { ...ALL_ON };
  writeExperienceFeatures({ ...base, [key]: value });
}

/** Coarse write from the first-run modal: rich = everything on, lite = everything off. */
export function writeExperienceModeSetting(mode: ExperienceMode) {
  writeExperienceFeatures(mode === "lite" ? { ...ALL_OFF } : { ...ALL_ON });
}

function useExperienceFeaturesState(): ExperienceFeatures {
  // Initialise to all-on and read in an effect so server-rendered markup
  // matches hydration.
  const [features, setFeatures] = useState<ExperienceFeatures>(ALL_ON);

  useEffect(() => {
    const sync = () => setFeatures(readExperienceFeatures());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== EXPERIENCE_MODE_STORAGE_KEY) {
        return;
      }
      sync();
    };

    sync();
    window.addEventListener(EXPERIENCE_MODE_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EXPERIENCE_MODE_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return features;
}

export function useExperienceFeatures() {
  const features = useExperienceFeaturesState();
  const setFeature = useCallback((key: ExperienceFeatureKey, value: boolean) => {
    setExperienceFeature(key, value);
  }, []);
  return [features, setFeature] as const;
}

/** Convenience for a component that only cares about one feature's visibility. */
export function useExperienceFeature(key: ExperienceFeatureKey): boolean {
  return useExperienceFeaturesState()[key];
}

/** Legacy coarse hook: mode plus a coarse setter. Kept for existing callers. */
export function useExperienceMode() {
  const features = useExperienceFeaturesState();
  const mode: ExperienceMode = isLiteFeatures(features) ? "lite" : "rich";
  const setMode = useCallback((next: ExperienceMode) => writeExperienceModeSetting(next), []);
  return [mode, setMode] as const;
}

/** Convenience for consumers that only branch on the full-lite pathway. */
export function useLiteMode(): boolean {
  return isLiteFeatures(useExperienceFeaturesState());
}
