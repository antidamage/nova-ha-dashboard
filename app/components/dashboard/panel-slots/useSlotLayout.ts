"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY, quickSlotLayout, type QuickSlotLayout } from "../quick-access/dial-model";

/** What a panel has placed, which is all the layout needs beyond its own box. */
export type SlotCounts = {
  /** How many modules are placed — the number of slots, which decides the grid. */
  count: number;
  /** How many dials are placed, so a readings-only panel reserves no dial box. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/** The counts a list of items makes, for {@link useSlotLayout}. */
export function slotCounts(items: readonly { kind: string }[]): SlotCounts {
  return {
    count: items.length,
    // A panel's own content is neither a dial nor a readings tile: it draws
    // whatever the panel hands it, so it reserves no dial box and no tile measure.
    dials: items.filter((item) => item.kind !== "outside" && item.kind !== "panel").length,
    readings: items.filter((item) => item.kind === "outside").length,
  };
}

/**
 * A panel's slot grid, measured from the panel itself
 * (specs/control-maps/modules.md, "Slots and the Quick Access row";
 * specs/quick-access-card.md).
 *
 * Every panel is a grid of equal slots — one per module placed on it — and this
 * feeds it the two things it cannot know from CSS: how wide it is, and, where the
 * panel has a height of its own, how tall. Both are re-derived whenever the panel
 * resizes or the orientation flips, and the one dial size every dial on the panel
 * is drawn at comes out of the same answer.
 */
export function useSlotLayout(
  rowRef: RefObject<HTMLElement | null>,
  counts: SlotCounts,
  /** A panel that divides a height of its own: Quick Access, in landscape. */
  dividesHeight = false,
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
          // Only a panel that divides a height of its own has one to give: Quick
          // Access is a column of the page's fixed column height in landscape and
          // its rows split it (landscape.css). Everywhere else the panel is as
          // tall as its content, so a measured height would describe the result
          // of the dial size about to be chosen from it — a loop, and a jittering
          // one.
          height: dividesHeight && !portrait.matches ? row.clientHeight : 0,
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
  }, [rowRef, count, dials, readings, dividesHeight]);

  return layout;
}
