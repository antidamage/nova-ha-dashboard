"use client";

import { useEffect, useState, type RefObject } from "react";
import { NOVA_THEME_SET_CHANGE_EVENT } from "../../accentColor";
import { isLightSurface } from "./encoder-model";

/** The knob's light/dark treatment: pinned by `knobSkin`, or following the device theme. */
export function useKnobSkin(knobSkin: "auto" | "dark" | "light" | undefined, rootRef: RefObject<HTMLDivElement | null>) {
  const [mode, setMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    if (knobSkin === "dark" || knobSkin === "light") {
      setMode(knobSkin);
      return;
    }

    // No pinned skin: follow the device theme's knob-skin setting, falling back
    // to sampling the surface behind the knob when it is "auto" or absent (a
    // demo page outside the dashboard's theme).
    const read = () => {
      const setting = knobSkin ?? document.documentElement.dataset.knobSkin;
      if (setting === "dark" || setting === "light") {
        setMode(setting);
        return;
      }
      setMode(isLightSurface(rootRef.current) ? "light" : "dark");
    };
    read();
    const events = ["nova-accent-change", NOVA_THEME_SET_CHANGE_EVENT, "nova-sun-change"];
    for (const event of events) window.addEventListener(event, read);
    // applyDeviceTheme writes the setting straight onto <html>, including from
    // the config editor's live preview, which fires no theme-set event.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributeFilter: ["data-knob-skin"] });
    return () => {
      for (const event of events) window.removeEventListener(event, read);
      observer.disconnect();
    };
  }, [knobSkin]);
  return mode;
}
