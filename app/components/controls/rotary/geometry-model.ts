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
import {
  ARC_END,
  ARC_MIN_SPAN,
  ARC_SPAN,
  ARC_START,
  GAP_SHARE,
  LABEL_VALUE_CLEARANCE,
  RING_LIMIT,
  THUMB_LENGTH,
  THUMB_THICKNESS,
  TITLE_CLEARANCE_SHARE,
  TITLE_END_CLEARANCE,
  TRACK_SHARE,
} from "./constants";
import type { RingGeometry } from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** The caption's font rule, `clamp(10px, 7.5% of size, 14px)`. */
export function captionFont(size: number) {
  return clamp(size * 0.075, 10, 14);
}

/**
 * The label font on a ring.
 *
 * Four labels sharing the bottom gap crowd each other: at 200px the rings are
 * 17px apart and the caption font is 14px, which left 3px between neighbouring
 * labels and they read as a block rather than a column. Adeline, 2026-09-12:
 * shrink the labels on a dial carrying four or more rings rather than moving
 * the rings apart, so the knob keeps its size. The 10px floor still wins — the
 * labels never shrink past legibility, they just stop growing.
 */
export function ringLabelFont(size: number, count: number, pitch: number) {
  const caption = captionFont(size);
  if (count < 4) return caption;
  return clamp(pitch - 6, 10, caption);
}

export function ringGeometry(size: number, count: number, titled = false): RingGeometry {
  const rings = clamp(Math.floor(count), 0, RING_LIMIT);
  const dialRadius = size * 0.622;
  const caption = captionFont(size);
  // The title's band sits between the dial and the innermost ring, and pushes
  // every ring out by its full height. A dial with no title keeps the geometry
  // it had, so `titleBand` is the one number the two cases differ by.
  const titleClearance = size * TITLE_CLEARANCE_SHARE;
  const titleBand = titled ? caption + 2 * titleClearance : 0;
  const titleRadius = dialRadius + titleClearance + caption / 2;
  // A curved label is a caption tall and sits on its ring's centreline, so the
  // pitch may never drop under it — at 100px a proportional pitch is 8.5px
  // against a 10px font. The track keeps its 6 : 2.5 share of the pitch. The
  // pitch is measured against the caption, not the (possibly smaller) label
  // font, so adding a fourth ring never pulls the rings closer together.
  const pitch = Math.max(size * (TRACK_SHARE + GAP_SHARE), caption + 2);
  const font = ringLabelFont(size, rings, pitch);
  const track = (pitch * TRACK_SHARE) / (TRACK_SHARE + GAP_SHARE);
  const gap = pitch - track;
  const radii = Array.from({ length: rings }, (_, index) => dialRadius + titleBand + gap + track / 2 + index * pitch);
  const thumbHalfAngle = radii.map((radius) => ((THUMB_LENGTH * track) / 2 / radius) * (180 / Math.PI));
  const overhang = rings > 0 ? ((THUMB_THICKNESS - 1) * track) / 2 : 0;
  return {
    size,
    dialRadius,
    knobRadius: size / 2,
    font,
    pitch,
    track,
    gap,
    titleBand,
    titleRadius,
    titleFootprint: 2 * (dialRadius + titleBand),
    radii,
    thumbHalfAngle,
    footprint: 2 * (dialRadius + titleBand + rings * pitch + overhang),
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
 * for the knob itself or beyond the last ring.
 *
 * Only the knob's own disc belongs to the knob. The colour ring and the bevel
 * around it go to the innermost ring, which otherwise offered a few pixels of
 * target hard against the knob's edge and lost nearly every press to it —
 * including presses dead on its thumb (Adeline, 2026-09-12). Every other ring
 * keeps a band of one pitch centred on its own track.
 */
export function ringAt(geometry: RingGeometry, distance: number) {
  if (geometry.radii.length === 0) return null;
  if (distance <= geometry.knobRadius) return null;
  const firstOuterEdge = geometry.radii[0] + geometry.pitch / 2;
  if (distance < firstOuterEdge) return 0;
  const index = 1 + Math.floor((distance - firstOuterEdge) / geometry.pitch);
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

/**
 * SVG path for the title arc: 7:30 clockwise over the top to 4:30, the same
 * 270° sweep the tracks use. Travelling that way over the top points the
 * text's "up" away from the centre, so it reads upright; the text is centred on
 * 12 o'clock with `text-anchor: middle` at `startOffset="50%"`.
 */
export function titlePath(cx: number, cy: number, radius: number) {
  return arcPath(cx, cy, radius, ARC_START, ARC_END);
}

/**
 * Room for the title: the arc's length, less a font size of clearance at each
 * end. The title does not shrink to fit (Adeline, 2026-09-12) — it runs wider
 * around the sides and is cut with an ellipsis only past this.
 */
export function titleRoom(geometry: RingGeometry) {
  const length = geometry.titleRadius * ((ARC_SPAN * Math.PI) / 180);
  return Math.max(0, length - 2 * TITLE_END_CLEARANCE * captionFont(geometry.size));
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
