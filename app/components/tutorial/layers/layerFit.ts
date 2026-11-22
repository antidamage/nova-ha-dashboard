/**
 * Sizing the layer stack so all of it always fits on screen (alex,
 * 2026-11-21: "always fit on-screen so it doesn't scroll the page"). Pure, so
 * it is tested without a browser.
 *
 * The stack is tilted back by a tilt the viewer drags between TILT_MIN_DEG
 * (straight down) and TILT_MAX_DEG, and turned about its own axis; each card
 * is lifted LIFT of its height above the one below, and a selected card a
 * further SELECT_LIFT. Turned any way, a card's on-screen width is at most its
 * diagonal, and its height at most the diagonal foreshortened by the tilt; the
 * lifts add their own height, also foreshortened. The card size is the worst
 * case over the whole tilt range, so the stack never resizes while it tilts.
 */

export const TILT_DEG = 55;
export const TILT_MIN_DEG = 0;
export const TILT_MAX_DEG = 75;
/** Degrees of turn or tilt per pixel dragged. */
export const DRAG_DEG_PER_PX = 0.3;
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
  /** How far to move the stack down so its tilted, lifted whole is centred, at `tiltDeg`. */
  shift: number;
};

const radians = (deg: number) => (deg * Math.PI) / 180;

export const clampTilt = (deg: number) => Math.max(TILT_MIN_DEG, Math.min(TILT_MAX_DEG, deg));

/** On-screen height per unit of scale at `tilt`: the card foreshortened plus the lifts. */
const tallAt = (tilt: number, diagonal: number, liftHeight: number) => diagonal * Math.cos(tilt) + liftHeight * Math.sin(tilt);

export function fitStack(frame: Size, cards: number, body: Size, tiltDeg = TILT_DEG): StackFit {
  const diagonal = Math.hypot(frame.width, frame.height) || 1;
  const lifts = Math.max(0, cards - 1) * LIFT + SELECT_LIFT;
  const liftHeight = lifts * frame.height;
  // d cos t + h sin t peaks at atan(h / d); else at one end of the range.
  const peak = Math.atan2(liftHeight, diagonal);
  const candidates = [radians(TILT_MIN_DEG), radians(TILT_MAX_DEG)];
  if (peak > candidates[0] && peak < candidates[1]) candidates.push(peak);
  const tall = Math.max(...candidates.map((tilt) => tallAt(tilt, diagonal, liftHeight)));
  const scale = Math.max(0, Math.min((body.width * MARGIN) / diagonal, (body.height * MARGIN) / tall));
  const card = { width: frame.width * scale, height: frame.height * scale };
  const lift = card.height * LIFT;
  return { card, lift, shift: (lifts * card.height * Math.sin(radians(clampTilt(tiltDeg)))) / 2 };
}
