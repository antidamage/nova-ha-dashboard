"use client";

import { useEffect } from "react";
import { setPageUpdatesPaused } from "./dashboard/pageUpdatePause";
import { useClickDragScroll } from "./dashboard/useClickDragScroll";

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

// Headless mount for the page's scroll behaviour. Rendered once from the root
// layout so it covers every route (/ and /config). Renders nothing. It pauses
// expensive dashboard work while the viewport is moving (native scroll stays
// native) and hosts the click-and-drag (hand-tool) pan for mouse users. The
// old eased wheel-momentum engine was removed with the smooth-scroll feature.
export function SmoothScrollController() {
  usePauseUpdatesWhileScrolling();
  useClickDragScroll();
  return null;
}
