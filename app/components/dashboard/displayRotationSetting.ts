"use client";

// "Allow display rotation" is a per-machine preference (specs/kiosk-display-rotation.md):
// it never travels with a theme, never reaches the shared host theme, and an
// absent key means off, so a screen nobody has configured shows no rotate button.
// Same storage model as autoFullscreenSetting.

import { useCallback, useEffect, useState } from "react";
import { useAutoRotatingDevice } from "./autoRotationSensing";

export const DISPLAY_ROTATION_STORAGE_KEY = "nova.dashboard.displayRotation.v1";
export const DISPLAY_ROTATION_CHANGE_EVENT = "nova-display-rotation-change";

export function readDisplayRotationSetting(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DISPLAY_ROTATION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeDisplayRotationSetting(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISPLAY_ROTATION_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be denied; same-page state still updates.
  }
  window.dispatchEvent(new CustomEvent(DISPLAY_ROTATION_CHANGE_EVENT));
}

export function useDisplayRotationSetting() {
  // False on the server and first client render so hydration matches.
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const sync = () => setEnabledState(readDisplayRotationSetting());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === DISPLAY_ROTATION_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(DISPLAY_ROTATION_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DISPLAY_ROTATION_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeDisplayRotationSetting(next);
  }, []);

  return [enabled, setEnabled] as const;
}

/**
 * The rotate button's whole gate. `allowed` is the stored setting AND a device
 * that does not rotate itself; `selfRotating` is what the config switch shows
 * as its reason for being disabled.
 */
export function useDisplayRotation() {
  const [enabled, setEnabled] = useDisplayRotationSetting();
  const selfRotating = useAutoRotatingDevice();
  return { allowed: enabled && !selfRotating, enabled, selfRotating, setEnabled };
}
