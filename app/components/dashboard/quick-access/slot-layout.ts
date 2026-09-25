"use client";

import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";
import { panelSlotGrid, type PanelSlotGrid } from "../panelSlots";
import {
  QUICK_READINGS_MIN,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDE_LINE,
  quickDialBox,
  quickDialSizeForCell,
  quickDialSlot,
} from "./dial-model";

/**
 * The Quick Access card's grid, measured from the card itself
 * (specs/quick-access-card.md, "The layout slots").
 *
 * The card is a grid of equal slots — and this is the measuring that turns the
 * card's box and the number of modules into a grid (`panelSlots.ts`, the rule
 * every panel shares), with the dial size that fills a slot in it.
 *
 * Adeline, 2026-09-25: the panel is "defined as having ... either 1x4, 4x1 or 2x2
 * slot arrangements", and the content in a slot "will scale up or down to fit in
 * the slot". Before this the card was a stack of lines — the dial line, the
 * climate knobs, the readings — each holding as many slots as fitted.
 *
 * Adeline, 2026-09-25, naming what the grid is FOR: "the first four slots
 * (strictly for dial controls) should be in a 2x2 grid if there's room, or a 1x4
 * grid if there isn't ... there is also a date module in here, make the date all
 * one line and make a wide slot at the bottom for it. if there is no content in
 * it, the line slot collapses." So the grid is sized from the card's DIALS, not
 * from every module placed on it: the dials take the 2x2 (a single line, 1x4 down
 * a tall card, where the card has no room for two columns), and every module that
 * is not a dial takes a wide line slot under them — one line tall, and gone
 * entirely when nothing is placed there (`panelSlots.ts`, `wideBottom`).
 */

/** The card's slots: the arrangement, the slot, the gap and the dial size. */
export type QuickSlotLayout = PanelSlotGrid & {
  /** Dial diameter every dial on the card is drawn at. */
  size: number;
  /** One dial row's height, or 0 where the card's height is its content's. */
  rowHeight: number;
  /**
   * The height of one wide line slot, or 0 where the card has none. Taken out of
   * the card's height before the dial rows divide it.
   */
  lineHeight: number;
};

export type QuickSlotRequest = {
  /** The card's own width, from its measurement. */
  width: number;
  /** The card's content height, or 0 where it has none of its own. */
  height: number;
  /** Whether the card is in portrait, where the rings must stay on screen. */
  portrait: boolean;
  /** How many modules are placed: what decides the arrangement. */
  count: number;
  /** How many dial controls are placed: the slots the grid is for. */
  dials: number;
  /** How many readings tiles are placed. */
  readings: number;
  /**
   * Whether the card lays its dials out in the grid and every other module along
   * a wide line slot under it, rather than laying every module out in the one
   * grid. True for the card (Adeline, 2026-09-25).
   */
  wideBottom: boolean;
};

/**
 * The card's grid, measured from the card itself, with the dial size that fills a
 * slot in it.
 *
 * The grid holds the card's DIALS — 2x2 for four, a single line where the card
 * has no room for two columns — and every module that is not a dial takes a wide
 * line slot under them, one line tall, which collapses when nothing is placed
 * there (Adeline, 2026-09-25; `panelSlots.ts`).
 *
 * A dial slot is at least the widest thing placed in the card needs — a knob's
 * rings in portrait, its titled box in landscape — and the arrangement is settled
 * from that, so the same rules hold on a phone, a tablet and the kiosk.
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
  const grid = panelSlotGrid({ count, dials, minWidth, portrait, wideBottom: request.wideBottom, width });
  // Each wide line slot is its own height, whatever the card's own is: it is a
  // line, not a share of them.
  const lineHeight = grid.wide > 0 ? QUICK_WIDE_LINE : 0;
  if (grid.columns === 0 || grid.slot <= 0) {
    // Nothing placed, or nothing measured yet. The card's own design size, so the
    // first painted frame is a card rather than dials at their floor.
    return { ...grid, lineHeight, rowHeight: 0, size: QUICK_TEMPERATURE_SIZE };
  }
  // What is left for the dials once every wide line has taken its own height.
  const total = grid.rows + grid.wide;
  const rowHeight = height > 0 ? (height - grid.wide * lineHeight - (total - 1) * grid.gap) / Math.max(1, grid.rows) : 0;
  const size = quickDialSizeForCell({ height: rowHeight, portrait, width: grid.slot });
  return { ...grid, lineHeight, rowHeight, size };
}
