"use client";

import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";
import { PANEL_SLOT_GAP_MAX, PANEL_SLOT_GAP_MIN, panelSlotGrid, type PanelSlotGrid } from "../panelSlots";

/**
 * The Quick Access card's slots (specs/quick-access-card.md).
 *
 * The card is a grid of equal slots — one per module placed on it — and this is
 * the panel's own half of that rule: the measuring that turns the card's box and
 * the number of modules into a grid (`panelSlots.ts`, the rule every panel
 * shares), the dial size that fills a slot, and the minimum a slot has to be
 * before the content in it stops working.
 *
 * Adeline, 2026-09-23: "tidy up the layout slots the modules go into by making
 * them all the same size and evenly spaced and distributed." Adeline,
 * 2026-09-25: the panel is "defined as having ... either 1x4, 4x1 or 2x2 slot
 * arrangements", and the content in a slot "will scale up or down to fit in the
 * slot". Before this the card was a stack of lines — the dial line, the climate
 * knobs, the readings — each holding as many slots as fitted.
 */

/**
 * A third bigger than the knob's 100px floor (Adeline, 2026-09-12): at the floor
 * the climate segments read as small beside the rest of the line, and the dial is
 * the one thing on the card you actually turn. No longer a fixed size — a dial
 * now fills the slot it is in, up to `QUICK_DIAL_MAX` — but still the size a slot
 * held before this, and so the size the card was designed around.
 */
export const QUICK_TEMPERATURE_SIZE = 133;
/** The lighting and amplifier dials match the climate knobs (2026-09-12). */
export const QUICK_ENCODER_SIZE = QUICK_TEMPERATURE_SIZE;

/** The most rings any Quick Access knob carries: the Lounge aircon's four. */
export const QUICK_WIDEST_RINGS = 4;

/**
 * The largest dial the card may draw (Adeline, 2026-09-25: content "will scale up
 * or down to fit in the slot"). This is the ceiling the controls themselves
 * declare — TemperatureEncoder and ColorEncoder both top out at 200 — rather than
 * a look of its own, so a slot with room for a bigger knob gets one.
 */
export const QUICK_DIAL_MAX = 200;

/**
 * The air a titled dial's layout box keeps under its knob, and the preset row
 * that takes it back. Two halves of one measure: `--quick-preset-band` is
 * dial-preset-band.css's 44px, and `dialPresetPull` is the negative margin that
 * pulls the row up by the box's lower title band (specs/dial-preset-band.md).
 */
export const QUICK_PRESET_BAND = 44;
export const QUICK_DIAL_ROW_GAP = 8;

/** The narrowest a readings tile may be before its words stop fitting. */
export const QUICK_READINGS_MIN = 208;

/** Portrait, the same test the card's portrait CSS keys on. */
export const PORTRAIT_QUERY = "(aspect-ratio <= 1)";

/** Width the widest knob's rings reach at `size` — the portrait slot width. */
export function quickDialSlot(size: number) {
  return ringGeometry(size, QUICK_WIDEST_RINGS, true).footprint;
}

/**
 * The box a titled dial lays out in with no rings. This is what a slot must hold
 * where the rings float free of the layout — landscape, where they are allowed to
 * cross a neighbouring dial and the card has no room to reserve their reach for
 * every slot.
 */
export function quickDialBox(size: number) {
  return ringGeometry(size, 0, true).titleFootprint;
}

/**
 * The height one slot's dial needs: its box, the gap under it, and the preset
 * row it carries.
 *
 * The card's rows are EQUAL, so this is the tallest slot kind placed — and a
 * climate knob is the tallest. Its band is reserved as a spacer with no pull
 * taken back (`.quick-climate::after`; the negative margin that gives a titled
 * dial's lower title band back belongs to the preset tiles,
 * `.quick-segment-lights .quick-button-pair`), so a knob's slot is the box plus
 * the whole band. Measuring the tiles' instead left the model believing a 2x2
 * card filled its rows when its knobs needed ~18px more each: the card's content
 * came to 619px inside a 598px column, with the scrollbar hidden
 * (landscape.css, `scrollbar-width: none`) — so the arrangement Adeline named
 * for a desktop was quietly cut off. Found by review, measured in Chromium.
 */
export function quickSlotHeight(size: number) {
  return quickDialBox(size) + QUICK_DIAL_ROW_GAP + QUICK_PRESET_BAND;
}

/** The largest dial of the range whose `measure` fits `budget`, floor 100px. */
function largestDial(measure: (size: number) => number, budget: number): number {
  for (let size = QUICK_DIAL_MAX; size > TEMPERATURE_ENCODER_MIN_SIZE; size -= 1) {
    if (measure(size) <= budget) {
      return size;
    }
  }
  return TEMPERATURE_ENCODER_MIN_SIZE;
}

/**
 * The dial size that fills a slot: the largest that fits its width and, where the
 * panel has a height to divide, its height. A slot too small for even the floor
 * size draws the floor — the knob has no smaller legible form, which is why a
 * card that cannot fit its modules scrolls rather than shrinking them away.
 */
export function quickDialSizeForCell(request: { width: number; height: number; portrait: boolean }): number {
  const { width, height, portrait } = request;
  const byWidth = largestDial((size) => (portrait ? quickDialSlot(size) : quickDialBox(size)), width);
  // A panel with no height of its own — a portrait page, where the card is as
  // tall as its content and the page scrolls — constrains the dial by width only.
  const byHeight = height > 0 ? largestDial(quickSlotHeight, height) : QUICK_DIAL_MAX;
  return Math.min(byWidth, byHeight);
}

/** The card's slots: the arrangement, the slot, the gap and the dial size. */
export type QuickSlotLayout = PanelSlotGrid & {
  /** Dial diameter every dial on the card is drawn at. */
  size: number;
  /** One row's height, or 0 where the card's height is its content's. */
  rowHeight: number;
};

export type QuickSlotRequest = {
  /** The card's own width, from its measurement. */
  width: number;
  /** The card's content height, or 0 where it has none of its own. */
  height: number;
  /** Whether the card is in portrait, where the rings must stay on screen. */
  portrait: boolean;
  /** How many slots are placed: what decides the arrangement. */
  count: number;
  /** How many dials are placed, so a readings-only card reserves no dial box. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
};

/**
 * The card's grid, measured from the card itself, with the dial size that fills a
 * slot in it.
 *
 * A slot is at least the widest thing placed in the card needs — a knob's rings
 * in portrait, its titled box in landscape, the readings tile's own measure — and
 * the arrangement is settled from that (`panelSlots.ts`), so the same rules hold
 * on a phone, a tablet and the kiosk.
 */
export function quickSlotLayout(request: QuickSlotRequest): QuickSlotLayout {
  const { count, dials, height, portrait, readings, width } = request;
  const dialMin = dials > 0 ? (portrait ? quickDialSlot(TEMPERATURE_ENCODER_MIN_SIZE) : quickDialBox(TEMPERATURE_ENCODER_MIN_SIZE)) : 0;
  // The readings tile's own measure is what the card is laid out to when it is
  // the only thing placed on it. Alongside dials it is a preference, not a floor:
  // it wraps its readings inside whatever slot the dials need (Adeline,
  // 2026-09-25 — the place belongs to the arrangement, and the arrangement
  // belongs to the knobs that cannot draw smaller).
  const minWidth = Math.max(dialMin, readings > 0 && dials === 0 ? QUICK_READINGS_MIN : 0);
  const grid = panelSlotGrid({ count, minWidth, portrait, width });
  if (grid.columns === 0 || grid.slot <= 0) {
    // Nothing placed, or nothing measured yet. The card's own design size, so the
    // first painted frame is a card rather than dials at their floor.
    return { ...grid, rowHeight: 0, size: QUICK_TEMPERATURE_SIZE };
  }
  const rowHeight = height > 0 ? (height - (grid.rows - 1) * grid.gap) / grid.rows : 0;
  const size = quickDialSizeForCell({ height: rowHeight, portrait, width: grid.slot });
  return { ...grid, rowHeight, size };
}
