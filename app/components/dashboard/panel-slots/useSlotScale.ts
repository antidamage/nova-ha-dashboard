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

/**
 * The smallest a DIAL slot's content may be scaled. Below it the content is drawn
 * at the size it needs and the panel scrolls: a knob's floor is 100px for the same
 * reason (specs/temperature-encoder.md). It is a legibility floor over a control
 * somebody has to be able to hit.
 */
export const SLOT_SCALE_FLOOR = 0.7;

/** The smallest a line slot may be drawn at. A sanity clamp, not a floor. */
export const LINE_SLOT_SCALE_MIN = 0.05;

/**
 * The factor a DIAL slot draws itself at: the size it needs, unless it fits
 * already or is below the legibility floor — and below the floor it keeps its own
 * size and the panel scrolls instead. That is the one thing a scale must never do:
 * hide a control where nobody can reach it.
 */
export function dialScaleFactor(needed: number): number {
  return needed >= 1 || needed <= SLOT_SCALE_FLOOR ? 1 : Math.round(needed * 1000) / 1000;
}

/**
 * The factor a wide LINE slot draws itself at: the size it needs to fit the line,
 * with NO legibility floor.
 *
 * A line is one row of the panel's whole width and it has no scroll fallback of
 * its own — the panel's `fits` answer is the dials', and the card "never draws a
 * horizontal scrollbar" — so stopping at `SLOT_SCALE_FLOOR` would put the line's
 * end past the panel's edge, which is the defect this scaling was introduced to
 * remove. It scales to fit however narrow the panel is; nothing on a line is a
 * control in this build (the readings tile is a labelled group of readouts), so
 * there is no hit target to keep legible, and a panel narrow enough to shrink it
 * far is already reporting that the modules placed on it do not fit.
 */
export function lineScaleFactor(needed: number): number {
  if (needed >= 1) {
    return 1;
  }
  return Math.max(LINE_SLOT_SCALE_MIN, Math.round(needed * 1000) / 1000);
}

/** Whether the panel's rows divide a height of its own, and are shares. */
export type SlotScaleState = {
  /** True while the rows are pure shares of the panel; false when it scrolls. */
  fits: boolean;
  /** One factor for every slot on the panel, 1 when nothing has to shrink. */
  scale: number;
  /** The factor the wide line slots use, measured against their own line. */
  wideScale: number;
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
    dividesHeight: boolean;
    gap: number;
    rows: number;
  },
): SlotScaleState {
  const { available: given, dividesHeight, gap, rows } = options;
  const [state, setState] = useState<SlotScaleState>({ fits: true, scale: 1, wideScale: 1 });

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
        setState({ fits: true, scale: 1, wideScale: 1 });
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
      for (const slot of slots) {
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
        wideScale: lineScaleFactor(wide),
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
  }, [rowRef, dividesHeight, gap, rows, given]);

  return state;
}
