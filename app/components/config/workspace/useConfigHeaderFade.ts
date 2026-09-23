"use client";

import { useEffect } from "react";
import { CONFIG_HEADER_FADE_DISTANCE } from "./constants";

/**
 * Drives the header fade strip (`.header-fade-strip`, the theme's "Orb Shadow"
 * slot — specs/header-fade.md) from page scroll on /config.
 *
 * The dashboard's strip is driven by NovaAvatar's own scroll handler, which
 * does not exist here: there is no status orb on the config page, so nothing
 * else sets `--nova-header-fade`. This is the same continuous 0..1 function of
 * scrollY the dashboard uses, so the strip fades in as the page starts to
 * scroll and reverses exactly when the page scrolls back up.
 *
 * Deliberately unlike the dashboard, it never toggles the
 * `nova-header-controls-disabled` class: that pair of rules fades the header
 * buttons out and stops taking their input as the orb shrinks, and on the
 * config page the three fixed icons are the header — they stay live at every
 * scroll position (specs/config-page-header.md).
 */
export function useConfigHeaderFade() {
  useEffect(() => {
    const root = document.documentElement;
    const onScroll = () => {
      const t = Math.min(1, Math.max(0, (window.scrollY || 0) / CONFIG_HEADER_FADE_DISTANCE));
      root.style.setProperty("--nova-header-fade", t.toFixed(4));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.style.removeProperty("--nova-header-fade");
    };
  }, []);
}
