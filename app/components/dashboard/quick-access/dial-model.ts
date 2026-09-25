/**
 * The Quick Access card's dial geometry (specs/quick-access-card.md).
 *
 * How wide a knob's box is, how far its rings reach, how tall the slot holding one
 * has to be, and the largest dial that fits a budget — the same numbers for the
 * climate knob, the lighting dial and the amplifier dial. The card's GRID — how
 * many columns it has, how wide a slot is and which dial size a slot gets — is
 * `slot-layout.ts`, which reads these.
 *
 * Adeline, 2026-09-23: "tidy up the layout slots the modules go into by making
 * them all the same size and evenly spaced and distributed." Adeline, 2026-09-25:
 * the panel is "defined as having ... either 1x4, 4x1 or 2x2 slot arrangements",
 * and the content in a slot "will scale up or down to fit in the slot".
 */

import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";

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
 * that takes it back. Two halves of one measure: `--dial-preset-band` is
 * dial-preset-band.css's 44px, and `dialPresetPull` is the negative margin that
 * pulls the row up by the box's lower title band (specs/dial-preset-band.md).
 */
export const QUICK_PRESET_BAND = 44;
export const QUICK_DIAL_ROW_GAP = 8;

/** The narrowest a readings tile may be before its words stop fitting. */
export const QUICK_READINGS_MIN = 208;

/**
 * The height of one wide line slot: a line of a module's own content, which is
 * what every module that is not a dial gets under the card's dial grid (Adeline,
 * 2026-09-25: "make the date all one line and make a wide slot at the bottom for
 * it"). The card's rows are shares of its own height, so this line comes out of
 * that total before the dials divide what is left (`slot-layout.ts`), and the
 * stylesheet is given the same figure as the wide row's track.
 */
export const QUICK_WIDE_LINE = 56;

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

