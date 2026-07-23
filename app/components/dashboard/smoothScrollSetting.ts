"use client";

import { useCallback, useEffect, useState } from "react";

// Smooth scrolling is a per-device preference: it never travels with a theme,
// is never written to the shared host theme, and survives theme loads/resets.
//
// This stores only the user's *preference*. The wheel-momentum engine
// (useSmoothWheelScroll) additionally hard-gates on lite mode and
// prefers-reduced-motion, so the effective on/off is
//   pref && !lite && !reducedMotion
// computed at the engine, not here. That keeps lite/reduced-motion always
// authoritative (the low-power kiosk, being the archetypal lite device, gets it
// off for free) while still letting any device force it off explicitly.
//
// Default when unset is ON: capable devices get eased wheel scrolling out of the
// box; lite/reduced-motion devices never see it regardless.
const SMOOTH_SCROLL_STORAGE_KEY = "nova.dashboard.smoothScroll.v1";
const SMOOTH_SCROLL_CHANGE_EVENT = "nova-smooth-scroll-change";

// Per-frame approach fraction (Lenis-style lerp) for the wheel-momentum engine.
// Higher = snappier/faster settle, lower = floatier/slower. Mirrors the LERP
// constant that used to be hardcoded in useSmoothWheelScroll.
const SMOOTH_SCROLL_SPEED_STORAGE_KEY = "nova.dashboard.smoothScrollSpeed.v1";
const SMOOTH_SCROLL_SPEED_CHANGE_EVENT = "nova-smooth-scroll-speed-change";
export const SMOOTH_SCROLL_SPEED_DEFAULT = 0.18;
export const SMOOTH_SCROLL_SPEED_MIN = 0.05;
export const SMOOTH_SCROLL_SPEED_MAX = 0.45;

export { SMOOTH_SCROLL_STORAGE_KEY, SMOOTH_SCROLL_CHANGE_EVENT, SMOOTH_SCROLL_SPEED_STORAGE_KEY, SMOOTH_SCROLL_SPEED_CHANGE_EVENT };

export function readSmoothScrollSetting(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    const stored = window.localStorage.getItem(SMOOTH_SCROLL_STORAGE_KEY);
    if (stored === "false") {
      return false;
    }
    // "true" or unset (undecided) → on by default.
    return true;
  } catch {
    return true;
  }
}

export function writeSmoothScrollSetting(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SMOOTH_SCROLL_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be denied in private/restricted contexts; the in-page state still updates.
  }
  window.dispatchEvent(new CustomEvent(SMOOTH_SCROLL_CHANGE_EVENT));
}

export function useSmoothScrollSetting() {
  // Initialise to the SSR-safe default and read in an effect so server-rendered
  // markup matches hydration.
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    const sync = () => setEnabledState(readSmoothScrollSetting());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== SMOOTH_SCROLL_STORAGE_KEY) {
        return;
      }
      sync();
    };

    sync();
    window.addEventListener(SMOOTH_SCROLL_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SMOOTH_SCROLL_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeSmoothScrollSetting(next);
  }, []);

  return [enabled, setEnabled] as const;
}

function clampSmoothScrollSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return SMOOTH_SCROLL_SPEED_DEFAULT;
  }
  return Math.min(SMOOTH_SCROLL_SPEED_MAX, Math.max(SMOOTH_SCROLL_SPEED_MIN, value));
}

export function readSmoothScrollSpeedSetting(): number {
  if (typeof window === "undefined") {
    return SMOOTH_SCROLL_SPEED_DEFAULT;
  }

  try {
    const stored = window.localStorage.getItem(SMOOTH_SCROLL_SPEED_STORAGE_KEY);
    if (stored === null) {
      return SMOOTH_SCROLL_SPEED_DEFAULT;
    }
    return clampSmoothScrollSpeed(Number.parseFloat(stored));
  } catch {
    return SMOOTH_SCROLL_SPEED_DEFAULT;
  }
}

export function writeSmoothScrollSpeedSetting(speed: number) {
  if (typeof window === "undefined") {
    return;
  }

  const clamped = clampSmoothScrollSpeed(speed);
  try {
    window.localStorage.setItem(SMOOTH_SCROLL_SPEED_STORAGE_KEY, String(clamped));
  } catch {
    // Storage can be denied in private/restricted contexts; the in-page state still updates.
  }
  window.dispatchEvent(new CustomEvent(SMOOTH_SCROLL_SPEED_CHANGE_EVENT));
}

export function useSmoothScrollSpeedSetting() {
  const [speed, setSpeedState] = useState(SMOOTH_SCROLL_SPEED_DEFAULT);

  useEffect(() => {
    const sync = () => setSpeedState(readSmoothScrollSpeedSetting());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== SMOOTH_SCROLL_SPEED_STORAGE_KEY) {
        return;
      }
      sync();
    };

    sync();
    window.addEventListener(SMOOTH_SCROLL_SPEED_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SMOOTH_SCROLL_SPEED_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setSpeed = useCallback((next: number) => {
    const clamped = clampSmoothScrollSpeed(next);
    setSpeedState(clamped);
    writeSmoothScrollSpeedSetting(clamped);
  }, []);

  return [speed, setSpeed] as const;
}
