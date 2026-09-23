"use client";

import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";

/**
 * The Quick Access card's layout slots (specs/quick-access-card.md): one width
 * for every slot the modules go into, and the gap between them.
 *
 * The card used to size each slot to its own content — the pair of ring-less
 * dials took half the line each, a climate knob reserved its rings' reach, the
 * readings tile took the whole width — so three lines could hold three
 * different slot widths and nothing lined up with anything (Adeline,
 * 2026-09-23: "making them all the same size and evenly spaced and
 * distributed"). A slot is now the card's unit: every module placed on the
 * card gets one, they are all the same width, they fill the line they are on,
 * and the gap between them grows with them.
 */

/**
 * A third bigger than the knob's 100px floor (Adeline, 2026-09-12): at the
 * floor the climate segments read as small beside the rest of the line, and the
 * dial is the one thing on the card you actually turn.
 */
export const QUICK_TEMPERATURE_SIZE = 133;
/**
 * The lighting dial matches the climate dials (Adeline, 2026-09-12): in
 * portrait the three sit in one evenly-spread row and a smaller one there
 * looked like a mistake. 56px at first, then 84 once the segment's written
 * title went, now the climate size.
 */
export const QUICK_ENCODER_SIZE = QUICK_TEMPERATURE_SIZE;

/**
 * The most rings any Quick Access knob carries: the Lounge aircon's Mode, Fan,
 * Fresh Air and Timer (ClimateKnobs.tsx).
 */
export const QUICK_WIDEST_RINGS = 4;

/** Portrait, the same test the card's portrait CSS keys on. */
export const PORTRAIT_QUERY = "(aspect-ratio <= 1)";

/**
 * The gap between two slots, as a share of a slot's own width (Adeline,
 * 2026-09-23: "with some proportional spacing in between"). A slot that has
 * been scaled up to fill its line takes its spacing up with it, so a wide card
 * reads as generously spaced rather than as a wide card with pinched gaps; the
 * floor keeps a phone's slots apart, the ceiling stops a very wide card's
 * gap from eating the slot it belongs to.
 */
export const QUICK_SLOT_GAP_RATIO = 0.05;
export const QUICK_SLOT_GAP_MIN = 8;
export const QUICK_SLOT_GAP_MAX = 28;

/** The narrowest a readings tile may be before its words stop fitting. */
export const QUICK_READINGS_MIN = 208;

/** Width the widest knob's rings reach at `size` — the portrait slot width. */
export function quickDialSlot(size: number) {
  return ringGeometry(size, QUICK_WIDEST_RINGS, true).footprint;
}

/**
 * The box a titled dial lays out in with no rings. This is what a slot must
 * hold where the rings float free of the layout — landscape, where they are
 * allowed to cross a neighbouring dial and the card has no room to reserve
 * their reach for every slot.
 */
export function quickDialBox(size: number) {
  return ringGeometry(size, 0, true).titleFootprint;
}

/**
 * The widest dial the card may draw at `width` without a knob's rings leaving
 * the screen: portrait only, and the reason the dials shrink together on a
 * narrow phone (floor 100px, Adeline, 2026-09-14).
 */
export function quickDialSizeFor(width: number) {
  for (let size = QUICK_TEMPERATURE_SIZE; size > TEMPERATURE_ENCODER_MIN_SIZE; size -= 1) {
    if (quickDialSlot(size) <= width) return size;
  }
  return TEMPERATURE_ENCODER_MIN_SIZE;
}

/** One slot's width, the gap between slots, and how many share a line. */
export type QuickSlotLayout = {
  /** Dial diameter every dial on the card is drawn at. */
  size: number;
  /** The width of every slot on the card. */
  slot: number;
  /** The gap between slots, and between the card's lines. */
  gap: number;
  /** How many slots share a line at this width. */
  columns: number;
};

export type QuickSlotRequest = {
  /** The line's width, from the card's own measurement. */
  width: number;
  /** Whether the card is in portrait, where the rings must stay on screen. */
  portrait: boolean;
  /** How many slots the card's busiest line holds — it needs no more columns. */
  widestLine: number;
  /** How many dials are placed, so a readings-only card reserves no dial box. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/**
 * One width for every slot on the card.
 *
 * A slot is at least the widest thing placed in the card needs — a knob's
 * rings in portrait, its titled box in landscape, the readings tile's own
 * measure — and the card puts as many of them on a line as that minimum
 * allows. The slots then take the rest of the width between them, so a line is
 * always filled edge to edge, and the gap follows the slot up.
 */
export function quickSlotLayout(request: QuickSlotRequest): QuickSlotLayout {
  const { width, portrait, widestLine, dials, readings } = request;
  const size = portrait ? quickDialSizeFor(width) : QUICK_TEMPERATURE_SIZE;
  if (!(width > 0)) {
    return { columns: 1, gap: QUICK_SLOT_GAP_MIN, size, slot: 0 };
  }
  const dialMin = dials > 0 ? (portrait ? quickDialSlot(size) : quickDialBox(size)) : 0;
  const minimum = Math.max(dialMin, readings > 0 ? QUICK_READINGS_MIN : 0);
  const fits = Math.max(
    1,
    Math.min(widestLine, Math.floor((width + QUICK_SLOT_GAP_MIN) / (minimum + QUICK_SLOT_GAP_MIN))),
  );
  // The gap is a share of a slot, so the wider a line is the wider its gap — and
  // a wider gap leaves less room for the slots themselves. Choosing the count
  // from the minimum gap alone therefore let the slot fall under the width its
  // control was measured for (review found 5.8px at 1864px with six columns,
  // which in portrait is a knob's rings reaching past its slot). Take the widest
  // line whose slots still meet that minimum instead.
  for (let columns = fits; columns >= 1; columns -= 1) {
    const even = (width - (columns - 1) * QUICK_SLOT_GAP_MIN) / columns;
    const gap = Math.min(
      QUICK_SLOT_GAP_MAX,
      Math.max(QUICK_SLOT_GAP_MIN, Math.round(even * QUICK_SLOT_GAP_RATIO)),
    );
    // Rounded DOWN, so a whole line of slots can never add up to a hundredth of a
    // pixel more than the card gave it and wrap its last slot onto a second row.
    const slot = Math.floor(((width - (columns - 1) * gap) / columns) * 100) / 100;
    if (columns === 1 || slot >= minimum) {
      return { columns, gap, size, slot };
    }
  }
  // Unreachable: one column always fits the width it was given.
  return { columns: 1, gap: QUICK_SLOT_GAP_MIN, size, slot: width };
}
