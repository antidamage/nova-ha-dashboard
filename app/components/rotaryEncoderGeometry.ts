/**
 * Ring geometry and pointer maths for `RotaryEncoder`'s slider rings
 * (specs/color-encoder.md, "Rings — the arc sliders").
 *
 * Angles are clockwise degrees from 12 o'clock, the convention the dial's index
 * already uses. Every length is in px and derives from the knob diameter.
 *
 * A ring starts at 7:30 and ends at 4:30 unless its label and value need more
 * room in the bottom gap, in which case its end is pulled back anticlockwise
 * (specs/color-encoder.md, "Value on the right, and rings that shorten to fit").
 */

export const RING_LIMIT = 5;

/** Each track runs 7:30 → over the top → 4:30; the bottom 90° holds labels. */
export const ARC_START = -135;
export const ARC_END = 135;
export const ARC_SPAN = ARC_END - ARC_START;

/** A shortened ring never gets smaller than this, or it stops reading as a ring. */
export const ARC_MIN_SPAN = 180;

/** Track and gap as fractions of the knob diameter, before the pitch floor. */
const TRACK_SHARE = 0.06;
const GAP_SHARE = 0.025;

/** Thumb thickness and visible length (round ends included), in track widths. */
export const THUMB_THICKNESS = 1.3;
export const THUMB_LENGTH = 2.4;

/** Clearance between a ring's label and its value, in label font sizes. */
export const LABEL_VALUE_CLEARANCE = 1.5;

export type RingGeometry = {
  /** Knob diameter. */
  size: number;
  /** Radius of the dial's own footprint (`--re-outer / 2`). */
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
export function onArc(angle: number, end: number = ARC_END) {
  return angle >= ARC_START && angle <= end;
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
export function thumbAngle(t: number, halfAngle: number, end: number = ARC_END) {
  const start = ARC_START + halfAngle;
  return start + clamp(t, 0, 1) * (end - ARC_START - 2 * halfAngle);
}

/** Inverse of `thumbAngle`: where along the range an angle on the arc sits. */
export function fractionAt(angle: number, halfAngle: number, end: number = ARC_END) {
  const start = ARC_START + halfAngle;
  const span = end - ARC_START - 2 * halfAngle;
  if (span <= 0) return 0;
  return clamp((angle - start) / span, 0, 1);
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
 * SVG path through the label gap, left to right: the ring's start (7:30), under
 * the bottom, round to the ring's end. Travelling that way the text's "up"
 * points at the centre, so labels sit upright.
 */
export function labelPath(cx: number, cy: number, radius: number, end: number = ARC_END) {
  const from = polar(cx, cy, radius, ARC_START);
  const to = polar(cx, cy, radius, end);
  const large = gapSpan(end) > 180 ? 1 : 0;
  return `M ${from.x.toFixed(3)} ${from.y.toFixed(3)} A ${radius.toFixed(3)} ${radius.toFixed(3)} 0 ${large} 0 ${to.x.toFixed(3)} ${to.y.toFixed(3)}`;
}

/** Degrees of gap at the bottom for a ring ending at `end`. */
export function gapSpan(end: number = ARC_END) {
  return 360 - (end - ARC_START);
}

/** Arc length of the bottom gap on ring `index`. */
export function gapLength(geometry: RingGeometry, index: number, end: number = ARC_END) {
  return geometry.radii[index] * ((gapSpan(end) * Math.PI) / 180);
}

/**
 * Room for a label in the gap: the gap's arc length, less the tracks' round
 * ends (half a track each side) and half a track of clearance past each.
 */
export function labelRoom(geometry: RingGeometry, index: number, end: number = ARC_END) {
  return gapLength(geometry, index, end) - 2 * geometry.track;
}

/**
 * Where a ring's arc has to end for `label` and `value` to sit in its gap with
 * the clearances above, or `ARC_END` when they already fit. Widths are in px,
 * measured in the label's own font.
 *
 * The start never moves: only the end is pulled back, and never past
 * `ARC_MIN_SPAN`.
 */
export function ringEndFor(geometry: RingGeometry, index: number, labelWidth: number, valueWidth: number) {
  const needed = labelWidth + valueWidth + (valueWidth > 0 ? LABEL_VALUE_CLEARANCE * geometry.font : 0) + 2 * geometry.track;
  const radius = geometry.radii[index];
  if (radius <= 0) return ARC_END;
  if (needed <= gapLength(geometry, index)) return ARC_END;
  const neededDegrees = (needed / radius) * (180 / Math.PI);
  const end = 225 - neededDegrees;
  return clamp(end, ARC_START + ARC_MIN_SPAN, ARC_END);
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
