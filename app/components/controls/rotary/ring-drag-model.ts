/** One ring drag sample, and the fraction/value mapping a ring uses. */
import { ARC_END } from "./constants";
import { clamp, fractionAt, onArc } from "./geometry-model";
import type { RingDrag } from "./types";

/**
 * One pointer sample of a ring drag. Returns the new fraction and pin state.
 *
 * In the gap the value pins at the end it was nearer. Once pinned it stays
 * there until the pointer is back on the arc in that end's half, so coming out
 * of the gap on the far side can never jump the value across the range.
 */
export function dragStep(drag: RingDrag, angle: number, halfAngle: number, end: number = ARC_END): RingDrag {
  if (!onArc(angle, end)) {
    const pinned = drag.pinned ?? (drag.t < 0.5 ? "min" : "max");
    return { pinned, t: pinned === "min" ? 0 : 1 };
  }
  const t = fractionAt(angle, halfAngle, end);
  if (drag.pinned === "min" && t >= 0.5) return drag;
  if (drag.pinned === "max" && t < 0.5) return drag;
  return { pinned: null, t };
}

/** Maps a fraction onto a ring's range, snapping to `step` when it has one. */
export function valueAt(t: number, min: number, max: number, step?: number) {
  const raw = min + clamp(t, 0, 1) * (max - min);
  if (!step || step <= 0) return raw;
  const snapped = min + Math.round((raw - min) / step) * step;
  return clamp(snapped, Math.min(min, max), Math.max(min, max));
}

export function fractionOf(value: number, min: number, max: number) {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}
