/**
 * The maths behind a stepping ring's glide
 * (specs/color-encoder.md, "A step glides, it never snaps").
 *
 * A thumb is drawn from a 0–1 fraction of its own arc, and it closes on the
 * fraction its value stands at at a fixed number of degrees per second — so the
 * length of the step decides how long the move takes, not the size of the ring
 * or the size of the range.
 */
import { RING_GLIDE_DEG_PER_SEC } from "./constants";

/**
 * Where a glide from `from` to `to` has reached after `elapsedMs`. A fraction
 * of the ring's own arc, at `RING_GLIDE_DEG_PER_SEC` degrees per second, never
 * overshooting the destination.
 */
export function glideTowards(from: number, to: number, sweepDeg: number, elapsedMs: number) {
  const distance = to - from;
  if (distance === 0) return to;
  // A ring shortened to fit its label still glides in degrees, so it moves at
  // the same visual speed as a full one.
  const reached = (RING_GLIDE_DEG_PER_SEC / Math.max(1, sweepDeg)) * (Math.max(0, elapsedMs) / 1000);
  if (Math.abs(distance) <= reached) return to;
  return from + Math.sign(distance) * reached;
}
