import { describe, expect, it } from "vitest";
import { ringGeometry } from "../../rotaryEncoderGeometry";
import {
  PORTRAIT_QUERY,
  QUICK_ENCODER_SIZE,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDEST_RINGS,
  quickDialSizeFor,
  quickDialSlot,
  quickPairFits,
  quickPairWidth,
} from "./dial-model";

describe("the card's first line", () => {
  it("is the two dials' titled boxes", () => {
    for (const size of [100, 120, 133]) {
      expect(quickPairWidth(size)).toBeCloseTo(2 * ringGeometry(size, 0, true).titleFootprint, 6);
    }
    expect(quickPairWidth(200)).toBeGreaterThan(quickPairWidth(133));
  });

  it("fits a given width only when both dials do", () => {
    const width = quickPairWidth(133);
    expect(quickPairFits(133, width)).toBe(true);
    expect(quickPairFits(133, width - 1)).toBe(false);
  });
});

describe("the size the card picks", () => {
  it("is the full 133px on a wide portrait screen", () => {
    expect(quickDialSizeFor(1000)).toBe(QUICK_TEMPERATURE_SIZE);
    expect(QUICK_ENCODER_SIZE).toBe(QUICK_TEMPERATURE_SIZE);
  });

  it("shrinks for the pair, not only for one climate knob's rings", () => {
    // The rings alone would still fit a 384px row at 133px: it is the lighting
    // dial and the amplifier dial sharing the line that must.
    expect(quickDialSlot(QUICK_TEMPERATURE_SIZE)).toBeLessThanOrEqual(384);
    expect(quickDialSizeFor(384)).toBeLessThan(QUICK_TEMPERATURE_SIZE);
    expect(quickPairFits(quickDialSizeFor(384), 384)).toBe(true);
  });

  it("keeps a lone climate dial's rings on screen at every size it returns", () => {
    for (const width of [1000, 640, 440, 384, 343, 300, 272]) {
      expect(quickDialSlot(quickDialSizeFor(width))).toBeLessThanOrEqual(Math.max(width, quickDialSlot(100)));
    }
  });

  it("never goes below the 100px floor, even where no size fits", () => {
    expect(quickDialSizeFor(272)).toBe(100);
    expect(quickDialSizeFor(10)).toBe(100);
  });
});

describe("the layout's constants", () => {
  it("keys portrait on the orientation, and counts the widest knob's rings", () => {
    expect(PORTRAIT_QUERY).toBe("(aspect-ratio <= 1)");
    expect(QUICK_WIDEST_RINGS).toBe(4);
  });
});
