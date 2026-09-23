"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY, quickSlotLayout, type QuickSlotLayout } from "./dial-model";

/** What the card has placed, which is all the layout needs beyond its width. */
export type QuickSlotCounts = {
  /** The most slots any one line holds. */
  widestLine: number;
  /** How many dials are placed. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/**
 * The card's slot layout, measured from the card itself
 * (specs/quick-access-card.md). One slot width for every module placed, as many
 * slots on a line as that width allows, and the gap between them — re-derived
 * whenever the card's width or the orientation changes, so the same rules hold
 * on a phone, a tablet and the kiosk.
 *
 * Portrait shrinks every dial together when the card is narrower than one slot,
 * so no ring runs off the screen. Landscape keeps the fixed 133px: its slots
 * need only a dial's box, and its rings are free to float over the page.
 */
export function useQuickSlotLayout(
  rowRef: RefObject<HTMLDivElement | null>,
  counts: QuickSlotCounts,
): QuickSlotLayout {
  const { widestLine, dials, readings } = counts;
  const [layout, setLayout] = useState<QuickSlotLayout>(() =>
    quickSlotLayout({ dials, portrait: false, readings, widestLine, width: 0 }),
  );

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const update = () => {
      setLayout(
        quickSlotLayout({
          dials,
          portrait: portrait.matches,
          readings,
          widestLine,
          width: row.clientWidth,
        }),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(row);
    portrait.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", update);
    };
  }, [rowRef, widestLine, dials, readings]);

  return layout;
}
