/**
 * The factors a panel's slots draw themselves at. `useSlotScale` measures the slots
 * and these turn the measurements into a scale.
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

/** The most a growing line (the weather line) is scaled UP to fill its width. */
export const LINE_SLOT_GROW_MAX = 3;

/**
 * The factor a weather line draws itself at to fill the slot's width: above 1 where
 * the line is narrower than the slot, below it where it is wider. Width only — the
 * line's height follows the factor (`wideHeight`), so nothing measured here depends
 * on the height it is given.
 */
export function lineFillFactor(slotWidth: number, contentWidth: number): number {
  if (!(slotWidth > 0) || !(contentWidth > 0)) {
    return 1;
  }
  const factor = Math.round((slotWidth / contentWidth) * 1000) / 1000;
  return Math.min(LINE_SLOT_GROW_MAX, Math.max(LINE_SLOT_SCALE_MIN, factor));
}

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
