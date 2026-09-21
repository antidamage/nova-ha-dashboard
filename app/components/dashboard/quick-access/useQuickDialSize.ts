"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY, QUICK_TEMPERATURE_SIZE, quickDialSizeFor, quickPairFits } from "./dial-model";

export type QuickDialLayout = {
  /** Dial diameter, the same for every dial on the card. */
  size: number;
  /**
   * Whether the lighting and amplifier dials still fit side by side at that
   * size. A very narrow phone cannot hold two of even the smallest dial, and
   * they take a slot each and stack instead of overlapping.
   */
  pair: "together" | "stacked";
};

/**
 * Portrait shrinks every dial together when the card is narrower than one slot,
 * so no ring runs off the screen. Landscape keeps the fixed size: its layout
 * does not use the slot.
 */
export function useQuickDialSize(rowRef: RefObject<HTMLDivElement | null>): QuickDialLayout {
  const [layout, setLayout] = useState<QuickDialLayout>({ size: QUICK_TEMPERATURE_SIZE, pair: "together" });
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const update = () => {
      if (!portrait.matches) {
        setLayout({ size: QUICK_TEMPERATURE_SIZE, pair: "together" });
        return;
      }
      const width = row.clientWidth;
      const size = quickDialSizeFor(width);
      setLayout({ size, pair: quickPairFits(size, width) ? "together" : "stacked" });
    };
    const observer = new ResizeObserver(update);
    observer.observe(row);
    portrait.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", update);
    };
  }, [rowRef]);
  return layout;
}
