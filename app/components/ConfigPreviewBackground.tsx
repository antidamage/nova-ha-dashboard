"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FluidBackground } from "./FluidBackground";
import type { DeviceTheme } from "./accentColor";
import {
  EXPERIENCE_MODE_STORAGE_KEY,
  readExperienceFeatures,
} from "./dashboard/experienceModeSetting";

// Lets the config editor publish the theme it is currently editing so the config
// page can render the live fluid background behind the panels. Changing any
// background parameter updates the preview in realtime because FluidBackground
// re-reads the theme prop every frame.
type ConfigPreviewContextValue = {
  previewTheme: DeviceTheme | null;
  setPreviewTheme: (theme: DeviceTheme | null) => void;
};

const ConfigPreviewContext = createContext<ConfigPreviewContextValue | null>(null);
const EXPERIENCE_MODE_CHANGE_EVENT = "nova-experience-mode-change";

function readBackgroundPreviewEnabled() {
  if (typeof window === "undefined") {
    return true;
  }
  return readExperienceFeatures().background;
}

function useBackgroundPreviewEnabled() {
  const [enabled, setEnabled] = useState(readBackgroundPreviewEnabled);

  useEffect(() => {
    const sync = () => setEnabled(readBackgroundPreviewEnabled());
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

  return enabled;
}

export function useConfigPreviewBackground() {
  return useContext(ConfigPreviewContext);
}

export function ConfigPreviewBackgroundProvider({ children }: { children: ReactNode }) {
  const [previewTheme, setPreviewTheme] = useState<DeviceTheme | null>(null);

  return (
    <ConfigPreviewContext.Provider value={{ previewTheme, setPreviewTheme }}>
      {children}
    </ConfigPreviewContext.Provider>
  );
}

// Renders the live preview canvas. Must be a direct child of `.dashboard-shell`
// so the existing `> *:not(.fluid-background)` rule lifts the config content
// above the z-index:0 canvas.
export function ConfigPreviewBackground() {
  const context = useConfigPreviewBackground();
  const backgroundEnabled = useBackgroundPreviewEnabled();
  if (!backgroundEnabled || !context?.previewTheme) {
    return null;
  }
  return <FluidBackground theme={context.previewTheme} />;
}
