/**
 * A ring thumb's shape and its grab target (specs/color-encoder.md, "The thumb
 * is the only handle").
 *
 * The thumb is a piece of an annulus — two arcs on its ring's centre and two
 * radial ends — rather than a stroked arc with round caps, which read as a
 * rotated pill. Its hotspot is the same kind of sector: the ring's own band
 * radially, the thumb plus a pad angularly. The bands of neighbouring rings
 * meet and never overlap, so no two hotspots can ever share a point.
 */
import { THUMB_HOTSPOT_PAD } from "./constants";
import { polar } from "./geometry-model";
import type { RingGeometry } from "./types";

const fixed = (point: { x: number; y: number }) => `${point.x.toFixed(3)} ${point.y.toFixed(3)}`;

/**
 * SVG path for an annular sector centred on `angle`, `length` px long on its
 * centreline `radius` and `thickness` px across, its four corners rounded by
 * `corner` px. The path opens with the outer arc, so its first point and the
 * end of that arc sit symmetrically either side of `angle`.
 */
export function sectorPath(cx: number, cy: number, radius: number, angle: number, length: number, thickness: number, corner = 0) {
  const outer = radius + thickness / 2;
  const inner = Math.max(0, radius - thickness / 2);
  const half = (length / 2 / radius) * (180 / Math.PI);
  const from = angle - half;
  const to = angle + half;
  const c = Math.max(0, Math.min(corner, thickness / 2, length / 2));
  const outerInset = outer > 0 ? (c / outer) * (180 / Math.PI) : 0;
  const innerInset = inner > 0 ? (c / inner) * (180 / Math.PI) : 0;
  const at = (r: number, a: number) => fixed(polar(cx, cy, r, a));
  const large = (inset: number) => (to - from - 2 * inset > 180 ? 1 : 0);
  return [
    `M ${at(outer, from + outerInset)}`,
    `A ${outer.toFixed(3)} ${outer.toFixed(3)} 0 ${large(outerInset)} 1 ${at(outer, to - outerInset)}`,
    `Q ${at(outer, to)} ${at(outer - c, to)}`,
    `L ${at(inner + c, to)}`,
    `Q ${at(inner, to)} ${at(inner, to - innerInset)}`,
    `A ${inner.toFixed(3)} ${inner.toFixed(3)} 0 ${large(innerInset)} 0 ${at(inner, from + innerInset)}`,
    `Q ${at(inner, from)} ${at(inner + c, from)}`,
    `L ${at(outer - c, from)}`,
    `Q ${at(outer, from)} ${at(outer, from + outerInset)}`,
    "Z",
  ].join(" ");
}

/**
 * The radial band ring `index` owns: one pitch centred on its track, except
 * that the innermost ring reaches in to the knob's disc (the colour ring and
 * bevel are its, per `ringAt`).
 */
export function ringBand(geometry: RingGeometry, index: number) {
  const radius = geometry.radii[index];
  const outer = radius + geometry.pitch / 2;
  const inner = index === 0 ? geometry.knobRadius : radius - geometry.pitch / 2;
  return { inner, outer };
}

/** Half the hotspot's angular length on ring `index`, in degrees. */
export function hotspotHalfAngle(geometry: RingGeometry, index: number) {
  const pad = (THUMB_HOTSPOT_PAD * geometry.track) / geometry.radii[index] * (180 / Math.PI);
  return geometry.thumbHalfAngle[index] + pad;
}

/** SVG path for ring `index`'s hotspot, its thumb centred on `angle`. */
export function hotspotPath(geometry: RingGeometry, index: number, centre: number, angle: number) {
  const { inner, outer } = ringBand(geometry, index);
  const mid = (inner + outer) / 2;
  const length = 2 * hotspotHalfAngle(geometry, index) * (Math.PI / 180) * mid;
  return sectorPath(centre, centre, mid, angle, length, outer - inner);
}

/**
 * Which ring's thumb a press at `distance` and `angle` grabs, or `null` when
 * it misses every hotspot — a press on a track away from its thumb does
 * nothing. `thumbAngles[i]` is where ring `i`'s thumb is drawn, or `null` for a
 * ring with no grabbable thumb (a toggle, hidden, disabled).
 */
export function thumbAt(geometry: RingGeometry, distance: number, angle: number, thumbAngles: (number | null)[]) {
  for (let index = 0; index < geometry.radii.length; index += 1) {
    const at = thumbAngles[index];
    if (at === null || at === undefined) continue;
    const { inner, outer } = ringBand(geometry, index);
    if (distance <= inner || distance > outer) continue;
    if (Math.abs(angle - at) <= hotspotHalfAngle(geometry, index)) return index;
  }
  return null;
}

/**
 * Where a grabbed thumb should be aimed for a pointer at `angle`: the pointer
 * less the offset it had from the thumb's centre at the press, so grabbing a
 * thumb off-centre never jumps it. Wrapped back into (-180, 180], the range
 * `pointerAngle` reports.
 */
export function grabbedAngle(angle: number, offset: number) {
  let aimed = angle - offset;
  if (aimed > 180) aimed -= 360;
  if (aimed <= -180) aimed += 360;
  return aimed;
}
