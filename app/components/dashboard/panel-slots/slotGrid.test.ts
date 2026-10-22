import { describe, expect, it } from "vitest";
import { quickDialBox } from "../quick-access/dial-model";
import { quickSlotLayout } from "../quick-access/slot-layout";
import { dialSpreadStep } from "./slotGrid";

/** The kiosk's card: a 1000px row in portrait, four dials and the readings line. */
const KIOSK = { count: 5, dials: 4, height: 0, portrait: true, readings: 1, wideBottom: true, width: 1000 };

describe("the dials' even spread", () => {
  it("makes the gap between two dials the gap to each edge", () => {
    const layout = quickSlotLayout(KIOSK);
    expect(layout.columns).toBe(2);
    const dial = quickDialBox(layout.size);
    const step = dialSpreadStep(layout);
    // Centred in its slot and then moved by half a step, each dial's left edge.
    const left = (column: number, offset: number) =>
      column * (layout.slot + layout.gap) + (layout.slot - dial) / 2 + step * offset;
    const row = 2 * layout.slot + layout.gap;
    const edgeLeft = left(0, -0.5);
    const between = left(1, 0.5) - (left(0, -0.5) + dial);
    const edgeRight = row - (left(1, 0.5) + dial);
    expect(step).toBeLessThan(0);
    expect(between).toBeCloseTo(edgeLeft, 1);
    expect(edgeRight).toBeCloseTo(edgeLeft, 1);
  });

  it("does nothing for a single column", () => {
    expect(dialSpreadStep(quickSlotLayout({ ...KIOSK, width: 375 }))).toBe(0);
  });
});
