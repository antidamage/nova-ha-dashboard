"use client";

import { useEffect, type RefObject } from "react";

/** The smallest factor a row may be scaled to: a sanity clamp, not a floor. */
export const FIT_WIDTH_MIN = 0.05;

/**
 * The factor a row of natural width `content` is drawn at to fit `available`:
 * 1 when it fits already (or nothing is measured yet), never below
 * `FIT_WIDTH_MIN`.
 */
export function fitWidthFactor(available: number, content: number): number {
  if (!(available > 0) || !(content > 0) || content <= available) {
    return 1;
  }
  return Math.max(FIT_WIDTH_MIN, Math.round((available / content) * 1000) / 1000);
}

/**
 * Scales a one-line row down to the width of the box it sits in, instead of
 * letting it wrap or run past the edge. The factor is written to the row as
 * `--fit-width-scale`; the stylesheet applies it as a `transform`, which does not
 * change layout, so the content width measured here cannot feed back into itself.
 */
export function useFitWidth(rowRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const row = rowRef.current;
    const box = row?.parentElement;
    if (!row || !box || typeof ResizeObserver === "undefined") {
      return;
    }
    // A wide line slot scales its whole line itself (`useSlotScale`); scaling the
    // readings as well would shrink them twice.
    if (row.closest(".panel-slot-wide")) {
      return;
    }
    const measure = () => {
      // The box's content width: its padding is room the row must not use.
      const style = getComputedStyle(box);
      const available = box.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      row.style.setProperty("--fit-width-scale", String(fitWidthFactor(available, row.scrollWidth)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(row);
    measure();
    return () => observer.disconnect();
  }, [rowRef]);
}
