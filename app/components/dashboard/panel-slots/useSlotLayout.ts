"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY } from "../quick-access/dial-model";
import { quickSlotLayout, type QuickSlotLayout } from "../quick-access/slot-layout";

/** What a panel has placed, which is all the layout needs beyond its own box. */
export type SlotCounts = {
  /** How many modules are placed — the number of slots, which decides the grid. */
  count: number;
  /** How many dial controls are placed: the slots the grid is for. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/**
 * Whether a module is a DIAL CONTROL — the one kind of thing a panel's slot grid
 * is for (Adeline, 2026-09-25: "the first four slots (strictly for dial
 * controls)"). A lighting dial, the amplifier dial and a climate knob are; the
 * readings tile and a panel's own content are not.
 */
export function isDialKind(kind: string): boolean {
  return kind === "lighting" || kind === "amplifier" || kind === "climate";
}

/** The counts a list of items makes, for {@link useSlotLayout}. */
export function slotCounts(items: readonly { kind: string }[]): SlotCounts {
  return {
    count: items.length,
    // The dial controls, positively: everything else a panel can hold is a wide
    // line slot where the panel groups its slots — which is what makes the grid
    // 2x2 for four dials whatever else is on the card.
    dials: items.filter((item) => isDialKind(item.kind)).length,
    readings: items.filter((item) => item.kind === "outside").length,
  };
}

/**
 * The order a panel lays its modules out in where it groups its slots: the dials
 * first, in the order the slots are configured in, then everything else on the
 * wide line at the bottom (Adeline, 2026-09-25: the first four slots are strictly
 * for dial controls, and the module that is not one gets "a wide slot at the
 * bottom"). A panel that does not group them keeps the order it was given.
 */
export function slotItemsInOrder<T extends { kind: string }>(items: readonly T[], wideBottom: boolean): T[] {
  if (!wideBottom) {
    return [...items];
  }
  return [...items.filter((item) => isDialKind(item.kind)), ...items.filter((item) => !isDialKind(item.kind))];
}

/**
 * A panel's slot grid, measured from the panel itself
 * (specs/control-modules.md, "Slots and the Quick Access row";
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
  options: {
    /** A panel that divides a height of its own: Quick Access, in landscape. */
    dividesHeight?: boolean;
    /**
     * A panel that lays its dials out in the grid and every other module along a
     * wide line slot under it (the Quick Access card).
     */
    wideBottom?: boolean;
  } = {},
): QuickSlotLayout {
  const { count, dials, readings } = counts;
  const { dividesHeight = false, wideBottom = false } = options;
  const [layout, setLayout] = useState<QuickSlotLayout>(() =>
    quickSlotLayout({ count, dials, height: 0, portrait: false, readings, wideBottom, width: 0 }),
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
          // A wide line slot is one line, not a share of the panel's height, so
          // the dials divide what the lines leave rather than the whole box.
          wideBottom,
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
  }, [rowRef, count, dials, readings, dividesHeight, wideBottom]);

  return layout;
}
