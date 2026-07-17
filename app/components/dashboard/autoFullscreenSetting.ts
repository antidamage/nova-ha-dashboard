"use client";

import { useCallback, useEffect, useState } from "react";

// Auto-fullscreen is a per-device preference: it never travels with a theme,
// is never written to the shared host theme, and survives theme loads/resets.
const AUTO_FULLSCREEN_STORAGE_KEY = "nova.dashboard.autoFullscreen.v1";
const AUTO_FULLSCREEN_CHANGE_EVENT = "nova-auto-fullscreen-change";

// The flag used to live inside the stored theme set; migrate it out of the
// legacy theme entry the first time a device reads the standalone setting.
const LEGACY_THEME_STORAGE_KEY = "nova.dashboard.accent.v1";

type LegacyThemeValue = {
  autoFullscreenOnLoad?: unknown;
  themes?: Partial<Record<"dark" | "light", { autoFullscreenOnLoad?: unknown } | null>>;
};

function readLegacyAutoFullscreen(): boolean {
  try {
    const raw = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw) as LegacyThemeValue | null;
    return parsed?.autoFullscreenOnLoad === true
      || parsed?.themes?.dark?.autoFullscreenOnLoad === true
      || parsed?.themes?.light?.autoFullscreenOnLoad === true;
  } catch {
    return false;
  }
}

export function readAutoFullscreenSetting(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(AUTO_FULLSCREEN_STORAGE_KEY);
    if (stored === "true") {
      return true;
    }
    if (stored === "false") {
      return false;
    }

    const migrated = readLegacyAutoFullscreen();
    window.localStorage.setItem(AUTO_FULLSCREEN_STORAGE_KEY, migrated ? "true" : "false");
    return migrated;
  } catch {
    return false;
  }
}

export function writeAutoFullscreenSetting(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(AUTO_FULLSCREEN_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be denied in private/restricted contexts; the in-page state still updates.
  }
  window.dispatchEvent(new CustomEvent(AUTO_FULLSCREEN_CHANGE_EVENT));
}

export function useAutoFullscreenSetting() {
  // Initialise to false and read in an effect so server-rendered markup matches hydration.
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    const sync = () => setEnabledState(readAutoFullscreenSetting());
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== AUTO_FULLSCREEN_STORAGE_KEY) {
        return;
      }
      sync();
    };

    sync();
    window.addEventListener(AUTO_FULLSCREEN_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTO_FULLSCREEN_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    writeAutoFullscreenSetting(next);
  }, []);

  return [enabled, setEnabled] as const;
}
