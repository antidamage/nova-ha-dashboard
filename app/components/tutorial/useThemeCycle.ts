"use client";

import { useEffect, useRef } from "react";
import { setThemeOverridePreview } from "../theme/accent/override-preview";
import type { ThemeOverride } from "../theme/accent/types";

/** The theme button's own cycle order (specs/theme-override.md). */
export const THEME_CYCLE: readonly { mode: ThemeOverride; say: string }[] = [
  { mode: "unset", say: "Follows config: this screen uses the house theme." },
  { mode: "auto", say: "Auto: light by day, dark at night." },
  { mode: "light", say: "Light: always light on this screen." },
  { mode: "dark", say: "Dark: always dark on this screen." },
];
export const THEME_DWELL_MS = 3500;
export const THEME_DWELL_REDUCED_MS = 7000;

/**
 * The "Light and dark" step (specs/tutorial-mode.md): walks the four modes as
 * an in-memory preview, round and round, naming each. Paused, it holds the mode
 * on show and Resume carries on from it. The real button is inert meanwhile,
 * so no tap can store a mode. One cleanup clears the preview, which is every
 * way off the step: Back, Next, close, idle exit and unmount. Nothing is
 * stored, so a reload clears it too.
 */
export function useThemeCycle(
  active: boolean,
  button: HTMLElement | null,
  paused: boolean,
  reducedMotion: boolean,
  onSay: (text: string | null) => void,
) {
  const index = useRef(-1);

  useEffect(() => {
    if (!active) return;
    index.current = -1;
    const wasInert = button?.inert ?? false;
    if (button) button.inert = true;
    return () => {
      if (button) button.inert = wasInert;
      setThemeOverridePreview(null);
      onSay(null);
    };
  }, [active, button, onSay]);

  useEffect(() => {
    if (!active || paused) return;
    const show = () => {
      index.current = (index.current + 1) % THEME_CYCLE.length;
      setThemeOverridePreview(THEME_CYCLE[index.current].mode);
      onSay(THEME_CYCLE[index.current].say);
    };
    if (index.current < 0) show();
    const timer = window.setInterval(show, reducedMotion ? THEME_DWELL_REDUCED_MS : THEME_DWELL_MS);
    return () => window.clearInterval(timer);
  }, [active, paused, reducedMotion, onSay]);
}
