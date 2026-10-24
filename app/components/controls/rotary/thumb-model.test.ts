import { describe, expect, it } from "vitest";
import { THUMB_LENGTH } from "./constants";
import { ringGeometry, thumbAngle } from "./geometry-model";
import { grabbedAngle, hotspotHalfAngle, ringBand, sectorPath, thumbAt } from "./thumb-model";

describe("thumb hotspots", () => {
  const geometry = ringGeometry(200, 5, true);
  const lined = geometry.radii.map(() => 0);

  it("never overlap: every ring's band starts where the one inside it ends", () => {
    for (let index = 1; index < geometry.radii.length; index += 1) {
      expect(ringBand(geometry, index).inner).toBeCloseTo(ringBand(geometry, index - 1).outer, 9);
    }
  });

  it("send a press to exactly one ring, even with every thumb lined up", () => {
    const outerEdge = ringBand(geometry, geometry.radii.length - 1).outer;
    for (let distance = geometry.knobRadius + 0.25; distance <= outerEdge; distance += 0.25) {
      const hits = geometry.radii.filter((_, index) => thumbAt(geometry, distance, 0, lined.map((at, i) => (i === index ? at : null))) === index);
      expect(hits.length).toBe(1);
    }
  });

  it("miss a press on the track away from the thumb", () => {
    const at = thumbAngle(0.1, geometry.thumbHalfAngle[2]);
    const angles = geometry.radii.map(() => null as number | null);
    angles[2] = at;
    expect(thumbAt(geometry, geometry.radii[2], at, angles)).toBe(2);
    expect(thumbAt(geometry, geometry.radii[2], at + hotspotHalfAngle(geometry, 2) + 1, angles)).toBeNull();
  });

  it("ignore a ring with no grabbable thumb", () => {
    expect(thumbAt(geometry, geometry.radii[1], 0, [0, null, 0, 0, 0])).toBeNull();
  });
});

describe("the thumb's shape", () => {
  it("is a 3.6-track sector: two arcs on the ring's centre and two radial ends", () => {
    expect(THUMB_LENGTH).toBe(3.6);
    const path = sectorPath(100, 100, 50, 0, 20, 8, 0);
    expect(path.match(/A /g)?.length).toBe(2);
    expect(path).toMatch(/^M [\d.]+ [\d.]+ A 54\.000 54\.000 0 0 1/);
    expect(path).toMatch(/A 46\.000 46\.000 0 0 0/);
  });
});

describe("grabbedAngle", () => {
  it("keeps the press's offset from the thumb and wraps into (-180, 180]", () => {
    expect(grabbedAngle(40, 5)).toBe(35);
    expect(grabbedAngle(-178, 5)).toBe(177);
    expect(grabbedAngle(178, -5)).toBe(-177);
  });
});
