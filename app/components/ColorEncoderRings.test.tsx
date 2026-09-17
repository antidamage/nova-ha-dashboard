import { describe, expect, it } from "vitest";
import {
  ARC_END,
  ARC_START,
  RING_LIMIT,
  THUMB_LENGTH,
  captionFont,
  dragStep,
  fractionAt,
  labelRoom,
  pointerAngle,
  ringAt,
  ringGeometry,
  thumbAngle,
  titleRoom,
  valueAt,
} from "./rotaryEncoderGeometry";
import { useDialHarness } from "./ColorEncoderRings.fixtures";

useDialHarness();

describe("ring geometry", () => {
  it("is 6% track and 2.5% gap at 200px", () => {
    const geometry = ringGeometry(200, 5);
    expect(geometry.pitch).toBeCloseTo(17);
    expect(geometry.track).toBeCloseTo(12);
    expect(geometry.gap).toBeCloseTo(5);
    expect(geometry.dialRadius).toBeCloseTo(124.4);
    expect(geometry.radii[0]).toBeCloseTo(124.4 + 5 + 6);
    geometry.radii.slice(1).forEach((radius, index) => expect(radius - geometry.radii[index]).toBeCloseTo(17));
  });

  it("gives a title its own band and pushes every ring out by it", () => {
    const plain = ringGeometry(200, 5);
    const titled = ringGeometry(200, 5, true);
    // The caption plus 2% of the diameter of clearance each side.
    expect(titled.titleBand).toBeCloseTo(14 + 2 * 4);
    expect(titled.titleRadius).toBeCloseTo(124.4 + 4 + 7);
    titled.radii.forEach((radius, index) => expect(radius - plain.radii[index]).toBeCloseTo(titled.titleBand));
    expect(titled.footprint - plain.footprint).toBeCloseTo(2 * titled.titleBand);
    expect(titled.titleFootprint).toBeCloseTo(2 * (124.4 + titled.titleBand));
  });

  it("leaves the geometry alone when there is no title", () => {
    const plain = ringGeometry(200, 3);
    expect(plain.titleBand).toBe(0);
    expect(plain.titleFootprint).toBeCloseTo(2 * plain.dialRadius);
  });

  it("gives the title the whole 270 degrees, less a font size at each end", () => {
    const geometry = ringGeometry(200, 0, true);
    const arc = geometry.titleRadius * ((270 * Math.PI) / 180);
    expect(titleRoom(geometry)).toBeCloseTo(arc - 2 * 14);
  });

  it("floors the pitch at the label font plus 2px, keeping the track share", () => {
    for (const size of [56, 100]) {
      const geometry = ringGeometry(size, 5);
      expect(geometry.font).toBe(10);
      expect(geometry.pitch).toBe(12);
      expect(geometry.track / geometry.pitch).toBeCloseTo(6 / 8.5);
    }
  });

  it("never lets neighbouring labels overlap at any size", () => {
    for (let size = 50; size <= 200; size += 1) {
      const geometry = ringGeometry(size, 5);
      expect(geometry.pitch).toBeGreaterThanOrEqual(captionFont(size) + 2 - 1e-9);
    }
  });

  it("draws at most five rings", () => {
    expect(ringGeometry(200, 9).radii).toHaveLength(RING_LIMIT);
    expect(ringGeometry(200, 0).footprint).toBeCloseTo(200 * 1.244);
  });

  it("keeps the thumb on the track at both ends", () => {
    const geometry = ringGeometry(200, 3);
    geometry.radii.forEach((radius, index) => {
      const half = geometry.thumbHalfAngle[index];
      // Half the thumb's visible length, as an angle on this ring.
      expect(half).toBeCloseTo(((THUMB_LENGTH * geometry.track) / 2 / radius) * (180 / Math.PI));
      expect(thumbAngle(0, half) - half).toBeCloseTo(ARC_START);
      expect(thumbAngle(1, half) + half).toBeCloseTo(ARC_END);
      expect(fractionAt(thumbAngle(0.3, half), half)).toBeCloseTo(0.3);
    });
  });

  it("measures angles clockwise from 12 o'clock", () => {
    expect(pointerAngle(0, -1)).toBeCloseTo(0);
    expect(pointerAngle(1, 0)).toBeCloseTo(90);
    expect(pointerAngle(-1, 0)).toBeCloseTo(-90);
    expect(Math.abs(pointerAngle(0, 1))).toBeCloseTo(180);
  });

  it("places a press on the dial, a ring, or nothing by its distance", () => {
    const geometry = ringGeometry(200, 2);
    expect(ringAt(geometry, 100)).toBeNull();
    expect(ringAt(geometry, geometry.radii[0])).toBe(0);
    expect(ringAt(geometry, geometry.radii[1])).toBe(1);
    expect(ringAt(geometry, geometry.radii[1] + geometry.pitch)).toBeNull();
  });

  it("snaps to a step", () => {
    expect(valueAt(0.52, 0, 100, 5)).toBe(50);
    expect(valueAt(0.53, 0, 100, 5)).toBe(55);
    expect(valueAt(0.5, 10, 20)).toBe(15);
  });

  it("gives every label its gap less the track ends and clearance", () => {
    const geometry = ringGeometry(200, 1);
    expect(labelRoom(geometry, 0)).toBeCloseTo(geometry.radii[0] * (Math.PI / 2) - 2 * geometry.track);
  });
});

describe("dragging through the gap", () => {
  const half = 5;

  it("pins at the nearer end and never jumps across", () => {
    let drag = dragStep({ pinned: null, t: 0.9 }, 120, half);
    expect(drag.pinned).toBeNull();
    drag = dragStep(drag, 170, half);
    expect(drag).toEqual({ pinned: "max", t: 1 });
    // Out of the gap on the far side, at the min end: stays at max.
    drag = dragStep(drag, -130, half);
    expect(drag).toEqual({ pinned: "max", t: 1 });
    drag = dragStep(drag, -60, half);
    expect(drag.t).toBe(1);
    // Back on the arc in the max half: follows again.
    drag = dragStep(drag, 90, half);
    expect(drag.pinned).toBeNull();
    expect(drag.t).toBeCloseTo(fractionAt(90, half));
  });

  it("pins at min for a value in the lower half", () => {
    expect(dragStep({ pinned: null, t: 0.2 }, -170, half)).toEqual({ pinned: "min", t: 0 });
  });
});
