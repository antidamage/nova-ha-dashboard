"use client";

import { useEffect, useState } from "react";
import type { Size } from "./geometry-model";

/** Small hooks and waits the tour layer uses (specs/tutorial-mode.md). */

export const nextFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Resolves once `element` has held still for a few frames (or after 2s), so a
 * gesture is never read off a control the step's smooth scroll is still moving.
 */
export function settled(element: Element | null) {
  return new Promise<void>((resolve) => {
    if (!element) return resolve();
    const started = performance.now();
    let last = "";
    let still = 0;
    const check = () => {
      const rect = element.getBoundingClientRect();
      const now = `${Math.round(rect.left)},${Math.round(rect.top)}`;
      still = now === last ? still + 1 : 0;
      last = now;
      if (still >= 4 || performance.now() - started > 2000) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

export function useViewport(): Size {
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", read);
    window.addEventListener("orientationchange", read);
    return () => {
      window.removeEventListener("resize", read);
      window.removeEventListener("orientationchange", read);
    };
  }, []);
  return size;
}

/** The ring layer the copy's dial portals to the body, while it is mounted. */
export function useCopyRingLayer() {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setLayer(document.querySelector<HTMLElement>(".rotary-encoder-ring-layer[data-portal-tag='tutorial']"));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return layer;
}

export const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

