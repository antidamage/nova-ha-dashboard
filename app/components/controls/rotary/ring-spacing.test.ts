import { describe, expect, it } from "vitest";
import { THUMB_CLEARANCE, THUMB_THICKNESS } from "./constants";
import { captionFont, ringGeometry } from "./geometry-model";
import { ringBand, thumbAt } from "./thumb-model";

// specs/color-encoder.md, Geometry: neighbouring thumbs are half a thumb apart
// (alex, 2026-11-07, "it's too hard to select the right ring").
describe("ring spacing", () => {
  it("leaves half a thumb between neighbouring thumbs at every size", () => {
    expect(THUMB_CLEARANCE).toBe(0.5);
    for (let size = 50; size <= 200; size += 1) {
      const geometry = ringGeometry(size, 4);
      const thumb = THUMB_THICKNESS * geometry.track;
      expect(geometry.pitch - thumb).toBeCloseTo(thumb / 2, 9);
    }
  });

  it("keeps the track the thickness it had before the rings moved apart", () => {
    for (let size = 50; size <= 200; size += 1) {
      const before = Math.max(size * 0.085, captionFont(size) + 2) * (6 / 8.5);
      expect(ringGeometry(size, 4).track).toBeCloseTo(before, 9);
    }
  });

  it("gives each ring a hit band one pitch across", () => {
    for (const size of [100, 133, 200]) {
      const geometry = ringGeometry(size, 4, true);
      for (let index = 1; index < 4; index += 1) {
        const { inner, outer } = ringBand(geometry, index);
        expect(outer - inner).toBeCloseTo(geometry.pitch, 9);
      }
    }
  });

  it("grabs the right ring at either edge of its band with four thumbs lined up", () => {
    for (const size of [133, 200]) {
      const geometry = ringGeometry(size, 4, true);
      const lined = [0, 0, 0, 0];
      for (let index = 0; index < 4; index += 1) {
        const { inner, outer } = ringBand(geometry, index);
        expect(thumbAt(geometry, inner + 0.5, 0, lined)).toBe(index);
        expect(thumbAt(geometry, outer - 0.5, 0, lined)).toBe(index);
      }
    }
  });
});
