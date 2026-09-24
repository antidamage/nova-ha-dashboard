"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY, quickSlotLayout, type QuickSlotLayout } from "./dial-model";

/** What the card has placed, which is all the layout needs beyond its own box. */
export type QuickSlotCounts = {
  /** How many modules are placed — the number of slots, which decides the grid. */
  count: number;
  /** How many dials are placed, so a readings-only card reserves no dial box. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/**
 * The card's grid, measured from the card itself (specs/quick-access-card.md).
 *
 * The card is a grid of equal slots — one per module placed on it — and this
 * feeds it the two things it cannot know from CSS: how wide it is, and, in
 * landscape, how tall. Both are re-derived whenever the card resizes or the
 * orientation flips, and the one dial size every dial on the card is drawn at
 * comes out of the same answer.
 */
export function useQuickSlotLayout(
  rowRef: RefObject<HTMLDivElement | null>,
  counts: QuickSlotCounts,
): QuickSlotLayout {
  const { count, dials, readings } = counts;
  const [layout, setLayout] = useState<QuickSlotLayout>(() =>
    quickSlotLayout({ count, dials, height: 0, portrait: false, readings, width: 0 }),
  );

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined" || typeof ResizeObserver === "undefined") return;
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const update = () => {
      setLayout(
        quickSlotLayout({
          count,
          dials,
          // Only a landscape card has a height of its own to divide: there the
          // card is a column of the page's fixed column height and the rows split
          // it between them (landscape.css). In portrait the card is as tall as
          // its content, so a measured height describes the result of the dial
          // size about to be chosen from it — a loop, and a jittering one.
          height: portrait.matches ? 0 : row.clientHeight,
          portrait: portrait.matches,
          readings,
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
  }, [rowRef, count, dials, readings]);

  return layout;
}
