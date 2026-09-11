/**
 * Ring geometry and pointer maths for `RingedColorEncoder`
 * (specs/color-encoder-rings.md, "Geometry" and "Interaction").
 *
 * Angles are clockwise degrees from 12 o'clock, the convention the dial's index
 * already uses. Every length is in px and derives from the knob diameter.
 */

export const RING_LIMIT = 5;

/** Each track runs 7:30 → over the top → 4:30; the bottom 90° holds labels. */
export const ARC_START = -135;
export const ARC_END = 135;
export const ARC_SPAN = ARC_END - ARC_START;

/** Track and gap as fractions of the knob diameter, before the pitch floor. */
const TRACK_SHARE = 0.06;
const GAP_SHARE = 0.025;

/** Thumb thickness and visible length (round ends included), in track widths. */
export const THUMB_THICKNESS = 1.3;
export const THUMB_LENGTH = 2.4;

export type RingGeometry = {
  /** Knob diameter. */
  size: number;
  /** Radius of the dial's own footprint (`--ce-outer / 2`). */
  dialRadius: number;
  /** Label font size: the channel caption's rule. */
  font: number;
  pitch: number;
  track: number;
  gap: number;
  /** Centreline radius of each ring, innermost first. */
  radii: number[];
  /** Half the thumb's angular length on each ring, in degrees. */
  thumbHalfAngle: number[];
  /** Width and height of the whole control. */
  footprint: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** The caption's font rule, `clamp(10px, 7.5% of size, 14px)`. */
export function captionFont(size: number) {
  return clamp(size * 0.075, 10, 14);
}

export function ringGeometry(size: number, count: number): RingGeometry {
  const rings = clamp(Math.floor(count), 0, RING_LIMIT);
  const dialRadius = size * 0.622;
  const font = captionFont(size);
  // A curved label is `font` tall and sits on its ring's centreline, so the
  // pitch may never drop under it — at 100px a proportional pitch is 8.5px
  // against a 10px font. The track keeps its 6 : 2.5 share of the pitch.
  const pitch = Math.max(size * (TRACK_SHARE + GAP_SHARE), font + 2);
  const track = (pitch * TRACK_SHARE) / (TRACK_SHARE + GAP_SHARE);
  const gap = pitch - track;
  const radii = Array.from({ length: rings }, (_, index) => dialRadius + gap + track / 2 + index * pitch);
  const thumbHalfAngle = radii.map((radius) => ((THUMB_LENGTH * track) / 2 / radius) * (180 / Math.PI));
  const overhang = rings > 0 ? ((THUMB_THICKNESS - 1) * track) / 2 : 0;
  return {
    size,
    dialRadius,
    font,
    pitch,
    track,
    gap,
    radii,
    thumbHalfAngle,
    footprint: 2 * (dialRadius + rings * pitch + overhang),
  };
}

/** Clockwise degrees from 12 o'clock, in (-180, 180]. */
export function pointerAngle(dx: number, dy: number) {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Whether an angle is on the arc rather than in the label gap at the bottom. */
export function onArc(angle: number) {
  return angle >= ARC_START && angle <= ARC_END;
}

/**
 * The ring a press at distance `distance` from the centre lands on, or `null`
 * for the dial itself or beyond the last ring.
 */
export function ringAt(geometry: RingGeometry, distance: number) {
  if (distance <= geometry.dialRadius) return null;
  const index = Math.floor((distance - geometry.dialRadius) / geometry.pitch);
  return index < geometry.radii.length ? index : null;
}

/**
 * The thumb's centre travels an inset arc so its ends never leave the track;
 * the value still spans its full range across that travel.
 */
export function thumbAngle(t: number, halfAngle: number) {
  const start = ARC_START + halfAngle;
  return start + clamp(t, 0, 1) * (ARC_SPAN - 2 * halfAngle);
}

/** Inverse of `thumbAngle`: where along the range an angle on the arc sits. */
export function fractionAt(angle: number, halfAngle: number) {
  const start = ARC_START + halfAngle;
  return clamp((angle - start) / (ARC_SPAN - 2 * halfAngle), 0, 1);
}

/** A point on a circle about (cx, cy) at a clockwise-from-12 angle. */
export function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.sin(radians), y: cy - radius * Math.cos(radians) };
}

/** SVG path for a clockwise arc from `from` to `to` degrees. */
export function arcPath(cx: number, cy: number, radius: number, from: number, to: number) {
  const start = polar(cx, cy, radius, from);
  const end = polar(cx, cy, radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${large} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/**
 * SVG path through the label gap, left to right: 7:30 → 6 → 4:30. Travelling
 * that way the text's "up" points at the centre, so labels sit upright.
 */
export function labelPath(cx: number, cy: number, radius: number) {
  const start = polar(cx, cy, radius, ARC_START);
  const end = polar(cx, cy, radius, ARC_END);
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 0 0 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/**
 * Room for a label in the gap: the gap's arc length, less the tracks' round
 * ends (half a track each side) and half a track of clearance past each.
 */
export function labelRoom(geometry: RingGeometry, index: number) {
  return geometry.radii[index] * (Math.PI / 2) - 2 * geometry.track;
}

export type RingDrag = {
  /** The end the value is held at after the pointer entered the gap. */
  pinned: "min" | "max" | null;
  /** Last value fraction, 0–1. */
  t: number;
};

/**
 * One pointer sample of a ring drag. Returns the new fraction and pin state.
 *
 * In the gap the value pins at the end it was nearer. Once pinned it stays
 * there until the pointer is back on the arc in that end's half, so coming out
 * of the gap on the far side can never jump the value across the range.
 */
export function dragStep(drag: RingDrag, angle: number, halfAngle: number): RingDrag {
  if (!onArc(angle)) {
    const pinned = drag.pinned ?? (drag.t < 0.5 ? "min" : "max");
    return { pinned, t: pinned === "min" ? 0 : 1 };
  }
  const t = fractionAt(angle, halfAngle);
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
