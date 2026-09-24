"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY } from "../quick-access/dial-model";

/**
 * How much a panel's slot contents have to shrink to fit the slots
 * (specs/control-modules.md, "Every panel holds slots").
 *
 * Adeline, 2026-09-25: "the content was meant to scale DOWN inside the slot, to
 * fit. ideally they'd all scale the same amount, but we can work that out
 * later. get them scaling instead of cropping."
 *
 * So the content scales rather than being cut off, and the scale is ONE number
 * per panel — the smallest a slot needs — so a panel's dials stay the size of
 * each other. It is a paint-level scale (`transform: scale()`), which is what
 * makes it safe: a transform does not change layout, so the measurement it is
 * derived from cannot feed back into itself.
 *
 * Below `SLOT_SCALE_FLOOR` the panel stops scaling and grows its rows instead —
 * the content would be too small to read or to hit, and a panel that cannot fit
 * the modules placed on it scrolls, which is the over-packed case the spec
 * describes. That is the one thing a scale must never do: hide a control where
 * nobody can reach it.
 */

/**
 * The smallest a slot's content may be scaled. Below it the content is drawn at
 * the size it needs and the panel scrolls: a knob's floor is 100px for the same
 * reason (specs/temperature-encoder.md).
 */
export const SLOT_SCALE_FLOOR = 0.7;

/** Whether the panel's rows divide a height of its own, and are shares. */
export type SlotScaleState = {
  /** True while the rows are pure shares of the panel; false when it scrolls. */
  fits: boolean;
  /** One factor for every slot on the panel, 1 when nothing has to shrink. */
  scale: number;
};

export function useSlotScale(
  rowRef: RefObject<HTMLElement | null>,
  options: { dividesHeight: boolean; gap: number; rows: number },
): SlotScaleState {
  const { dividesHeight, gap, rows } = options;
  const [state, setState] = useState<SlotScaleState>({ fits: true, scale: 1 });

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof window === "undefined" || typeof ResizeObserver === "undefined") {
      return;
    }
    // The same test the stylesheet's landscape block uses: only a landscape panel
    // that divides a height of its own has rows that are shares. In portrait a
    // row is as tall as its content, so there is no share for content to be too
    // big for — measuring one anyway would scale a phone's dials down for nothing
    // (and the e2e's portrait rows caught exactly that).
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const divides = () => dividesHeight && !portrait.matches;
    const measure = () => {
      const slots = [...row.children] as HTMLElement[];
      if (!slots.length) {
        setState({ fits: true, scale: 1 });
        return;
      }
      // The share a row has when the rows are shares — computed from the
      // panel's own height, which the row sizing does not change, so this
      // number is the same in both modes and the measurement cannot oscillate.
      const available = divides()
        ? (row.clientHeight - Math.max(0, rows - 1) * gap) / Math.max(1, rows)
        : Number.POSITIVE_INFINITY;
      let needed = 1;
      for (const slot of slots) {
        // scrollWidth/scrollHeight are the content's own size whatever the box it
        // was given, and neither is affected by the transform. The BOX measured
        // against is the offset one — the element's own border box, the box it
        // was given — so a tile's 1px border and 8px padding are part of the room
        // the content has rather than something it "overflows". Comparing them
        // against the client box instead scaled every kiosk dial by 0.994 for a
        // border, which the floor assertion caught.
        const width = slot.offsetWidth > 0 ? slot.offsetWidth / Math.max(1, slot.scrollWidth) : 1;
        const height = Number.isFinite(available) ? available / Math.max(1, slot.scrollHeight) : 1;
        needed = Math.min(needed, width, height);
      }
      if (needed >= 1) {
        setState({ fits: true, scale: 1 });
        return;
      }
      setState(
        needed <= SLOT_SCALE_FLOOR
          ? { fits: false, scale: 1 }
          : { fits: true, scale: Math.round(needed * 1000) / 1000 },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    portrait.addEventListener("change", measure);
    // A slot's content can grow on its own — a longer preset list, a weather
    // tile with a word more — so the slots are observed, not only the row.
    for (const slot of [...row.children]) {
      observer.observe(slot);
    }
    measure();
    return () => {
      observer.disconnect();
      portrait.removeEventListener("change", measure);
    };
  }, [rowRef, dividesHeight, gap, rows]);

  return state;
}
