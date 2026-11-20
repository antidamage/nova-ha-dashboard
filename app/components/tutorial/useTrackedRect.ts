"use client";

import { useEffect, useState } from "react";
import type { Box } from "./geometry-model";

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/** How long the frame loop keeps running after the last scroll or resize. */
const SETTLE_MS = 400;

/**
 * An element's client rect, followed without a constant frame loop
 * (specs/tutorial-mode.md, "The mask"): re-read on any scroll (capture phase,
 * so sub-panel scrollers count), resize, and a ResizeObserver on the element,
 * with requestAnimationFrame running only while those keep firing, so eased
 * scrolls and the orb's scroll scale are followed to rest.
 */
export function useTrackedRect(element: Element | null): Box | null {
  const [rect, setRect] = useState<Box | null>(null);

  useEffect(() => {
    if (!element) {
      setRect(null);
      return;
    }
    let frame = 0;
    let until = 0;
    const read = () => {
      const r = element.getBoundingClientRect();
      const next = { left: r.left, top: r.top, width: r.width, height: r.height };
      setRect((held) => (same(held, next) ? held : next));
    };
    const tick = () => {
      read();
      frame = performance.now() < until ? window.requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      until = performance.now() + SETTLE_MS;
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    read();
    kick();
    window.addEventListener("scroll", kick, { capture: true, passive: true });
    window.addEventListener("resize", kick);
    window.addEventListener("orientationchange", kick);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(kick) : null;
    observer?.observe(element);
    return () => {
      window.removeEventListener("scroll", kick, { capture: true });
      window.removeEventListener("resize", kick);
      window.removeEventListener("orientationchange", kick);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [element]);

  return rect;
}

/** Re-reads on demand (step entry, a gesture), for one-off kicks. */
export function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}
