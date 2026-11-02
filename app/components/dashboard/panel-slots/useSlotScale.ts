"use client";

import { useEffect, useState, type RefObject } from "react";
import { PORTRAIT_QUERY } from "../quick-access/dial-model";
import {
  LINE_SLOT_GROW_MAX,
  LINE_SLOT_SCALE_MIN,
  SLOT_SCALE_FLOOR,
  dialScaleFactor,
  lineFillFactor,
  lineScaleFactor,
} from "./slot-scale-model";

/**
 * How much a panel's slot contents have to shrink to fit the slots
 * (specs/control-modules.md, "Every panel holds slots").
 *
 * alex, 2026-09-25: "the content was meant to scale DOWN inside the slot, to
 * fit. ideally they'd all scale the same amount, but we can work that out
 * later. get them scaling instead of cropping."
 *
 * So the content scales rather than being cut off, and the scale is ONE number
 * per panel — the smallest a slot needs — so a panel's dials stay the size of
 * each other. It is a paint-level scale (`transform: scale()`), which is what
 * makes it safe: a transform does not change layout, so the measurement it is
 * derived from cannot feed back into itself.
 *
 * The wide line slot at the bottom of a card is the one exception, and it is
 * measured against its OWN box rather than the panel's rows: it is a line, not a
 * share of the height, so the dials' share is the wrong budget for it — and
 * letting it push the shared factor would shrink every dial on the card to fit
 * one line of readings. It gets a factor of its own (`--wide-scale`).
 *
 * Below `SLOT_SCALE_FLOOR` the panel stops scaling and grows its rows instead —
 * the content would be too small to read or to hit, and a panel that cannot fit
 * the modules placed on it scrolls, which is the over-packed case the spec
 * describes. That is the one thing a scale must never do: hide a control where
 * nobody can reach it.
 */

export { LINE_SLOT_GROW_MAX, LINE_SLOT_SCALE_MIN, SLOT_SCALE_FLOOR, dialScaleFactor, lineFillFactor, lineScaleFactor };

/** Whether the panel's rows divide a height of its own, and are shares. */
export type SlotScaleState = {
  /** True while the rows are pure shares of the panel; false when it scrolls. */
  fits: boolean;
  /** One factor for every slot on the panel, 1 when nothing has to shrink. */
  scale: number;
  /** The factor the wide line slots use, measured against their own line. */
  wideScale: number;
  /**
   * The height a growing weather line needs at `wideScale`, or 0 where no line
   * grows. The card gives the line's row this height.
   */
  wideHeight: number;
};

export function useSlotScale(
  rowRef: RefObject<HTMLElement | null>,
  options: {
    /**
     * The height one slot has to fit in, where the caller has measured it (the
     * card's model divides a height of its own and knows a dial row's share).
     * Omitted, the share is derived from the panel's rows as before.
     */
    available?: number;
    /**
     * Scale a wide slot holding the weather line UP to the panel's width, not only
     * down (Quick Access, alex 2026-11-02). Other lines still only shrink.
     */
    growWeather?: boolean;
    dividesHeight: boolean;
    gap: number;
    rows: number;
  },
): SlotScaleState {
  const { available: given, dividesHeight, gap, growWeather = false, rows } = options;
  const [state, setState] = useState<SlotScaleState>({ fits: true, scale: 1, wideScale: 1, wideHeight: 0 });

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
        setState({ fits: true, scale: 1, wideScale: 1, wideHeight: 0 });
        return;
      }
      // The share a row has when the rows are shares — computed from the
      // panel's own height, which the row sizing does not change, so this
      // number is the same in both modes and the measurement cannot oscillate.
      // A caller that has measured it for itself (the card's model, which takes
      // the wide lines out of the height first) passes it in; it is only ever
      // read where the rows ARE shares, so portrait ignores it either way.
      const available = !divides()
        ? Number.POSITIVE_INFINITY
        : given !== undefined
          ? given
          : (row.clientHeight - Math.max(0, rows - 1) * gap) / Math.max(1, rows);
      let needed = 1;
      let wide = 1;
      let fill = 0;
      let fillHeight = 0;
      for (const slot of slots) {
        // The weather line fills the panel's width: scaled up as well as down. Its
        // natural size is its segment's, which a transform does not change.
        const segment = slot.firstElementChild as HTMLElement | null;
        if (growWeather && slot.dataset.slotRegion === "wide" && segment?.classList.contains("quick-segment-weather")) {
          // The segment can be squeezed to the slot's width with its content
          // spilling past it, so its natural width is the larger of its box and
          // its scroll width.
          fill = lineFillFactor(slot.offsetWidth, Math.max(segment.offsetWidth, segment.scrollWidth));
          fillHeight = Math.ceil(segment.offsetHeight * fill);
          continue;
        }
        // scrollWidth/scrollHeight are the content's own size whatever the box it
        // was given, and neither is affected by the transform. The BOX measured
        // against is the offset one — the element's own border box, the box it
        // was given — so a tile's 1px border and 8px padding are part of the room
        // the content has rather than something it "overflows". Comparing them
        // against the client box instead scaled every kiosk dial by 0.994 for a
        // border, which the floor assertion caught.
        const width = slot.offsetWidth > 0 ? slot.offsetWidth / Math.max(1, slot.scrollWidth) : 1;
        if (slot.dataset.slotRegion === "wide") {
          // A wide line slot's own box is its budget: one line of the panel's
          // whole width, not a share of its height.
          const height = slot.offsetHeight > 0 ? slot.offsetHeight / Math.max(1, slot.scrollHeight) : 1;
          wide = Math.min(wide, width, height);
          continue;
        }
        const height = Number.isFinite(available) ? available / Math.max(1, slot.scrollHeight) : 1;
        needed = Math.min(needed, width, height);
      }
      // The dials' factor, and the line's own. The dials stop at the legibility
      // floor (and then the panel scrolls); a line has no floor to stop at,
      // because stopping there is what leaves its end outside the panel.
      setState({
        fits: needed >= 1 || needed > SLOT_SCALE_FLOOR,
        scale: dialScaleFactor(needed),
        // A growing line has a factor of its own and the height that goes with it.
        wideScale: fill > 0 ? fill : lineScaleFactor(wide),
        wideHeight: fill > 1 ? fillHeight : 0,
      });
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
  }, [rowRef, dividesHeight, gap, growWeather, rows, given]);

  return state;
}
