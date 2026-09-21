import { describe, expect, it } from "vitest";
import { dialPresetPull, ringGeometry } from "./geometry-model";
import { DIAL_RADIUS_SHARE } from "./constants";

describe("the air under a titled dial's knob", () => {
  it("is half the title's band, which is what a preset row takes back", () => {
    for (const size of [100, 133, 200]) {
      const geometry = ringGeometry(size, 0, true);
      expect(dialPresetPull(size)).toBeCloseTo((geometry.titleFootprint - size * 2 * DIAL_RADIUS_SHARE) / 2, 6);
      // The air under the knob is a whole title band, not half of one.
      expect(dialPresetPull(size)).toBeCloseTo(geometry.titleBand, 6);
    }
  });

  it("grows with the knob, so a small dial's row is not pushed down as far", () => {
    expect(dialPresetPull(100)).toBeLessThan(dialPresetPull(133));
    expect(dialPresetPull(133)).toBeLessThan(dialPresetPull(200));
  });

  it("is nothing for a dial with no title, whose box is the knob itself", () => {
    const untitled = ringGeometry(133, 0, false);
    expect(untitled.titleFootprint).toBeCloseTo(133 * 2 * DIAL_RADIUS_SHARE, 6);
    expect((untitled.titleFootprint - 133 * 2 * DIAL_RADIUS_SHARE) / 2).toBe(0);
  });
});
