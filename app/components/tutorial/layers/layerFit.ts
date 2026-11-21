/**
 * Sizing the layer stack so all of it always fits on screen (alex,
 * 2026-11-21: "always fit on-screen so it doesn't scroll the page"). Pure, so
 * it is tested without a browser.
 *
 * The stack is tilted back by TILT_DEG and turned about its own axis; each card
 * is lifted LIFT of its height above the one below, and a selected card a
 * further SELECT_LIFT. Turned any way, a card's on-screen width is at most its
 * diagonal, and its height at most the diagonal foreshortened by the tilt; the
 * lifts add their own height, also foreshortened.
 */

export const TILT_DEG = 55;
export const LIFT = 0.16;
export const SELECT_LIFT = 0.08;
/** Room left for perspective, which enlarges the near cards a little. */
const MARGIN = 0.82;

export type Size = { width: number; height: number };

export type StackFit = {
  /** Card size in CSS pixels. */
  card: Size;
  /** The gap between cards along the stack, in CSS pixels. */
  lift: number;
  /** How far to move the stack down so its tilted, lifted whole is centred. */
  shift: number;
};

export function fitStack(frame: Size, cards: number, body: Size): StackFit {
  const tilt = (TILT_DEG * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const diagonal = Math.hypot(frame.width, frame.height) || 1;
  const lifts = Math.max(0, cards - 1) * LIFT + SELECT_LIFT;
  // Per unit of scale: on-screen width, and on-screen height including lifts.
  const across = diagonal;
  const tall = diagonal * cos + lifts * frame.height * sin;
  const scale = Math.max(0, Math.min((body.width * MARGIN) / across, (body.height * MARGIN) / tall));
  const card = { width: frame.width * scale, height: frame.height * scale };
  const lift = card.height * LIFT;
  return { card, lift, shift: (lifts * card.height * sin) / 2 };
}
