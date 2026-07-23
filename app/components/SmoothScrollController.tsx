"use client";

import { useEffect } from "react";
import { setPageUpdatesPaused } from "./dashboard/pageUpdatePause";
import { useClickDragScroll } from "./dashboard/useClickDragScroll";
import { useSmoothWheelScroll } from "./dashboard/useSmoothWheelScroll";

const SCROLL_IDLE_MS = 140;

function usePauseUpdatesWhileScrolling() {
  useEffect(() => {
    let idleTimer = 0;
    const onScroll = () => {
      setPageUpdatesPaused(true);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setPageUpdatesPaused(false), SCROLL_IDLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(idleTimer);
      setPageUpdatesPaused(false);
    };
  }, []);
}

// Headless mount for the eased wheel-scroll engine. Rendered once from the root
// layout so it covers every route (/ and /config) with a single window-level
// listener. Renders nothing; all behaviour lives in useSmoothWheelScroll, which
// self-gates on the per-device preference, lite mode, and reduced-motion.
export function SmoothScrollController() {
  usePauseUpdatesWhileScrolling();
  useSmoothWheelScroll();
  useClickDragScroll();
  return null;
}
