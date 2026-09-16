"use client";

import { Contrast, Moon, Sun, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  nextThemeOverride,
  readThemeOverride,
  THEME_OVERRIDE_CHANGE_EVENT,
  THEME_OVERRIDE_STORAGE_KEY,
  writeThemeOverride,
  type ThemeOverride,
} from "./accentColor";

// Per-device theme override (specs/theme-override.md). Icon-only, same box as
// ReloadButton; sits between Reload and the config cog.
const LABELS: Record<ThemeOverride, string> = {
  unset: "Theme: follows config",
  auto: "Theme: auto",
  light: "Theme: light",
  dark: "Theme: dark",
};

const ICONS = { unset: Contrast, auto: SunMoon, light: Sun, dark: Moon } as const;

export function ThemeOverrideButton() {
  // Server render and first client render agree on "unset"; the stored value
  // is read after mount.
  const [override, setOverride] = useState<ThemeOverride>("unset");

  useEffect(() => {
    const sync = () => setOverride(readThemeOverride());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_OVERRIDE_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(THEME_OVERRIDE_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_OVERRIDE_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const Icon = ICONS[override];
  const label = LABELS[override];
  return (
    <button
      type="button"
      className="dashboard-config-link dashboard-theme-override-link"
      aria-label={label}
      title={label}
      data-theme-override={override}
      data-demo-tooltip-title="Theme"
      data-demo-tooltip="Override the theme on this device only."
      onClick={() => writeThemeOverride(nextThemeOverride(readThemeOverride()))}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
