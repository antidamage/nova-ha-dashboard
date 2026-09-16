"use client";

import { type RefObject, useEffect } from "react";
import { isHorizontalDashboard } from "../../dashboard/useClickDragScroll";
import { SIDEBAR_SCALE_MIN, SIDEBAR_SCROLL_DISTANCE } from "./avatar-model";

/** Scroll-driven orb shrink plus the header fade progress on <html>. */
export function useAvatarScrollScale({
  hostRef,
  hidden,
  forceVisible,
  scrollScaleDistance,
  scrollScaleMin,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
  forceVisible: boolean;
  scrollScaleDistance: number;
  scrollScaleMin: number;
}) {
  useEffect(() => {
    if (hidden || forceVisible) return;
    const host = hostRef.current;
    if (!host) return;
    const root = document.documentElement;
    const distance = Math.max(1, scrollScaleDistance);
    const minScale = Math.max(0, Math.min(1, scrollScaleMin));
    const onScroll = () => {
      // The horizontal dashboard turns the top bar into a left sidebar driven
      // by sideways scroll (specs/landscape-layout.md): same progress value,
      // its own distance and floor: the 200px canvas at 1 -> 0.5.
      const horizontal = isHorizontalDashboard();
      const offset = horizontal ? window.scrollX || 0 : window.scrollY || 0;
      const t = Math.min(1, Math.max(0, offset / (horizontal ? SIDEBAR_SCROLL_DISTANCE : distance)));
      const scale = 1 + ((horizontal ? SIDEBAR_SCALE_MIN : minScale) - 1) * t;
      host.style.setProperty("--nova-avatar-scale", scale.toFixed(4));
      // Same scroll-derived progress drives the header fade strip, the mini
      // clock/date, and the reload/config buttons (globals.css) — one
      // continuous function of scrollY, not a triggered animation, so
      // stopping mid-scroll or scrolling back up reverses it exactly.
      root.style.setProperty("--nova-header-fade", t.toFixed(4));
      root.classList.toggle("nova-header-controls-disabled", t >= 0.5);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      root.style.removeProperty("--nova-header-fade");
      root.classList.remove("nova-header-controls-disabled");
    };
  }, [hidden, forceVisible, scrollScaleDistance, scrollScaleMin]);
}
