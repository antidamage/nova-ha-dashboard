import { describe, expect, it } from "vitest";
import { ringGeometry } from "../../rotaryEncoderGeometry";
import {
  PORTRAIT_QUERY,
  QUICK_DIAL_MAX,
  QUICK_ENCODER_SIZE,
  QUICK_PRESET_BAND,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDEST_RINGS,
  quickDialBox,
  quickDialSizeForCell,
  quickDialSlot,
  quickSlotHeight,
} from "./dial-model";

describe("the height a dial needs", () => {
  it("is its box, its preset row and the gap between them", () => {
    for (const size of [100, 133, 160, 200]) {
      // The whole band, not the tiles' pulled-back one: the card's rows are
      // equal and a climate knob reserves its band with nothing taken back
      // (found by review — this is what a 2x2 card is fitted to).
      expect(quickSlotHeight(size)).toBeCloseTo(quickDialBox(size) + 8 + QUICK_PRESET_BAND, 6);
    }
    // A cell of that height is exactly what the size needs, and one a whisker
    // shorter is not enough for it.
    expect(quickDialSizeForCell({ height: quickSlotHeight(150), portrait: false, width: 400 })).toBeGreaterThanOrEqual(149);
    expect(quickDialSizeForCell({ height: quickSlotHeight(150) - 6, portrait: false, width: 400 })).toBeLessThan(150);
  });
});

describe("the card's constants", () => {
  it("keys portrait on the orientation, and counts the widest knob's rings", () => {
    expect(PORTRAIT_QUERY).toBe("(aspect-ratio <= 1)");
    expect(QUICK_WIDEST_RINGS).toBe(4);
    expect(QUICK_ENCODER_SIZE).toBe(QUICK_TEMPERATURE_SIZE);
    expect(QUICK_DIAL_MAX).toBe(200);
  });

  it("measures a dial's box and its rings from its own geometry", () => {
    expect(quickDialBox(133)).toBeCloseTo(ringGeometry(133, 0, true).titleFootprint, 6);
    expect(quickDialSlot(133)).toBeGreaterThan(quickDialBox(133));
  });
});
