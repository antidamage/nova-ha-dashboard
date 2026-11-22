import { describe, expect, it } from "vitest";
import { quickDialBox } from "../quick-access/dial-model";
import { quickSlotLayout } from "../quick-access/slot-layout";
import { dialRowsCapped, dialSpreadStep, slotGridStyle } from "./slotGrid";

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

/** alex's card: three dials in one line, the weather line and the gauges line. */
const THREE_DIALS_TWO_LINES = { count: 5, dials: 3, readings: 1, grownLines: [true, false] };

function layoutFor(height: number) {
  return quickSlotLayout({ ...THREE_DIALS_TWO_LINES, height, portrait: false, wideBottom: true, width: 496 });
}

describe("slotGridStyle: lines on the floor, dials centred above them", () => {
  it("puts an equal spacer track above and under the dials when the rows have spare height", () => {
    const layout = layoutFor(560);
    expect(layout.rows).toBe(1);
    expect(dialRowsCapped(layout)).toBe(true);
    const style = slotGridStyle(layout, 1, { capRows: true }) as Record<string, string>;
    const tracks = style.gridTemplateRows.split(" ").filter(Boolean);
    expect(tracks.slice(0, 4)).toEqual(["minmax(0,", "1fr)", "auto", "minmax(0,"]);
    expect(tracks.slice(-2)).toEqual([`${layout.lineHeights[0]}px`, `${layout.lineHeights[1]}px`]);
    expect(style.alignContent).toBeUndefined();
    expect(style["--dial-spacer-end"]).toBe("3");
    expect(style["--dial-centre-shift"]).toBe(`${(layout.gap / 2).toFixed(2)}px`);
  });

  it("keeps the centred group where a capped card has no lines", () => {
    const layout = quickSlotLayout({ count: 3, dials: 3, readings: 0, height: 560, portrait: false, wideBottom: true, width: 496 });
    const style = slotGridStyle(layout, 1, { capRows: true }) as Record<string, string>;
    expect(style.alignContent).toBe("center");
    expect(style["--dial-spacer-end"]).toBeUndefined();
  });

  it("adds no spacers when the dials need the whole height", () => {
    const layout = layoutFor(220);
    expect(dialRowsCapped(layout)).toBe(false);
    const style = slotGridStyle(layout, 1, { capRows: true }) as Record<string, string>;
    expect(style.gridTemplateRows.startsWith("minmax(0, 1fr) minmax")).toBe(false);
    expect(style["--dial-spacer-end"]).toBeUndefined();
  });
});
