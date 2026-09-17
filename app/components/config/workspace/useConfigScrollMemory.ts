"use client";

import { useEffect, type MutableRefObject } from "react";
import { getConfigUiState, setConfigScroll } from "../../configUiState";
import { hasDeepLinkTarget } from "./config-path-model";
import type { ConfigCategoryId } from "./types";

export function useConfigScrollMemory(
  activeCategory: ConfigCategoryId | null,
  scrollRestoredRef: MutableRefObject<boolean>,
) {
  // Restore the scroll position when returning to /config within the 5-min window.
  // Wait a beat so accordions can re-expand (which changes page height) before scrolling.
  useEffect(() => {
    if (!activeCategory || scrollRestoredRef.current) {
      return;
    }
    scrollRestoredRef.current = true;
    if (hasDeepLinkTarget()) {
      return;
    }
    const state = getConfigUiState();
    if (!state || state.scrollTop <= 0) {
      return;
    }
    // Explicit instant restore so the jump never animates on return to /config.
    const id = window.setTimeout(() => window.scrollTo({ top: state.scrollTop, behavior: "auto" }), 300);
    return () => window.clearTimeout(id);
  }, [activeCategory]);

  // Remember the scroll position (throttled to once per animation frame).
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setConfigScroll(window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);
}
