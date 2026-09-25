import { describe, expect, it } from "vitest";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";
import {
  QUICK_DIAL_MAX,
  QUICK_READINGS_MIN,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDE_LINE,
  quickDialBox,
  quickDialSlot,
  quickSlotHeight,
} from "./dial-model";
import { quickSlotLayout } from "./slot-layout";

/** The card the demo ships: four dials and the readings tile. */
const FULL_CARD = { count: 5, dials: 4, readings: 1 };
/** A landscape card's content box: a 520px column of the page's own height. */
const LANDSCAPE = { height: 562, portrait: false };
/** Portrait: the card is as tall as its content, so it has no height to divide. */
const PORTRAIT = { height: 0, portrait: true };

describe("the card's grid", () => {
  it("is the 2x2 for four dials, whatever else the card holds", () => {
    // Adeline, 2026-09-25: "the first four slots (strictly for dial controls)
    // should be in a 2x2 grid if there's room". The fifth module is the readings
    // tile, and it does not take a column off the dials: it is a wide line under
    // them.
    const layout = quickSlotLayout({ ...FULL_CARD, width: 520, wideBottom: true, ...LANDSCAPE });
    expect([layout.columns, layout.rows]).toEqual([2, 2]);
    expect(layout.wide).toBe(1);
    expect(layout.lineHeight).toBe(QUICK_WIDE_LINE);
    // Two slots and the gap between them are the card's whole width.
    expect(2 * layout.slot + layout.gap).toBeCloseTo(520, 0);
  });

  it("collapses the line, and is then the grid it always was, with no non-dial", () => {
    const four = quickSlotLayout({ count: 4, dials: 4, readings: 0, width: 520, wideBottom: true, ...LANDSCAPE });
    expect([four.columns, four.rows]).toEqual([2, 2]);
    expect(four.wide).toBe(0);
    expect(four.lineHeight).toBe(0);
    // Nothing is reserved for a line that has nothing in it: the dials divide the
    // card's whole height.
    expect(four.rowHeight).toBeCloseTo((562 - four.gap) / 2, 6);
  });

  it("goes to one column of four dials where the card cannot hold two", () => {
    // Adeline, 2026-09-25: "a 1x4 grid if there isn't [room]". A phone in
    // portrait: two ring-bearing knobs side by side would run their opened rings
    // off the screen, so the four dials stack and the line sits under them.
    const phone = quickSlotLayout({ ...FULL_CARD, width: 343, wideBottom: true, ...PORTRAIT });
    expect([phone.columns, phone.rows]).toEqual([1, 4]);
    expect(phone.wide).toBe(1);
    expect(phone.slot).toBeCloseTo(343, 1);
    // A tablet's portrait width holds two of them, so it keeps the 2x2.
    const tablet = quickSlotLayout({ ...FULL_CARD, width: 772, wideBottom: true, ...PORTRAIT });
    expect([tablet.columns, tablet.rows]).toEqual([2, 2]);
  });

  it("is one line for two or three dials, along the panel's long axis", () => {
    const two = { count: 2, dials: 2, readings: 0, width: 520, wideBottom: true };
    expect(quickSlotLayout({ ...two, ...LANDSCAPE }).columns).toBe(2);
    expect(quickSlotLayout({ ...two, ...PORTRAIT }).rows).toBe(2);
    const three = { count: 3, dials: 3, readings: 0, width: 520, wideBottom: true };
    expect(quickSlotLayout({ ...three, ...LANDSCAPE }).columns).toBe(3);
    expect(quickSlotLayout({ ...three, ...PORTRAIT }).columns).toBe(1);
  });

  it("gives a card of nothing but lines one full-width line, and no grid", () => {
    const line = quickSlotLayout({ count: 1, dials: 0, readings: 1, width: 400, wideBottom: true, ...PORTRAIT });
    expect([line.columns, line.rows]).toEqual([1, 0]);
    expect(line.wide).toBe(1);
    expect(line.lineHeight).toBe(QUICK_WIDE_LINE);
  });

  it("fills the card's width whatever the arrangement", () => {
    for (const width of [319, 343, 440, 520, 772, 1000, 1920]) {
      for (const portrait of [true, false]) {
        const layout = quickSlotLayout({ ...FULL_CARD, height: portrait ? 0 : 562, portrait, wideBottom: true, width });
        const used = layout.columns * layout.slot + (layout.columns - 1) * layout.gap;
        expect(used, `${width}px portrait=${portrait} fills the card`).toBeCloseTo(width, 0);
      }
    }
  });

  it("needs no measurement to be shaped", () => {
    const unmeasured = quickSlotLayout({ ...FULL_CARD, wideBottom: true, ...LANDSCAPE, width: 0 });
    expect(unmeasured.columns).toBe(1);
    expect(unmeasured.slot).toBe(0);
    expect(unmeasured.size).toBe(QUICK_TEMPERATURE_SIZE);
    // The line still has its height in the frame before the measurement, so the
    // first paint draws a line slot rather than a zero-height one.
    expect(unmeasured.lineHeight).toBe(QUICK_WIDE_LINE);
  });
});

describe("the height the card divides", () => {
  it("takes every wide line out before the dial rows divide it", () => {
    // Adeline, 2026-09-25: the line slot is ONE line and the dials scale up to
    // fill what is left. The card's height is exactly its rows, its lines and the
    // gaps between them, so the dial size is derived from the height the dials
    // actually got rather than from a share of the whole.
    for (const height of [340, 562, 900]) {
      const layout = quickSlotLayout({ ...FULL_CARD, height, portrait: false, wideBottom: true, width: 520 });
      const rows = layout.rows + layout.wide;
      const used = layout.rows * layout.rowHeight + layout.wide * layout.lineHeight + (rows - 1) * layout.gap;
      expect(used, `${height}px card: its rows and lines are its height`).toBeCloseTo(height, 6);
    }
  });

  it("draws a smaller dial than the same card without a line to hold", () => {
    const withLine = quickSlotLayout({ ...FULL_CARD, width: 520, wideBottom: true, ...LANDSCAPE });
    const withoutLine = quickSlotLayout({ count: 4, dials: 4, readings: 0, width: 520, wideBottom: true, ...LANDSCAPE });
    // The line is height the dials no longer divide...
    expect(withLine.size).toBeLessThan(withoutLine.size);
    // ...and the dial is still the largest its row allows, and still scales past
    // the 100px floor the five-module card draws today: roomier per dial than the
    // 3x2 was, even with a line under it.
    expect(withLine.size).toBeGreaterThan(TEMPERATURE_ENCODER_MIN_SIZE);
    expect(quickSlotHeight(withLine.size)).toBeLessThanOrEqual(withLine.rowHeight);
    expect(quickSlotHeight(withLine.size + 1)).toBeGreaterThan(withLine.rowHeight);
  });
});

describe("the dial a slot gets", () => {
  it("scales up to fill the room a four-dial card has", () => {
    const four = quickSlotLayout({ count: 4, dials: 4, readings: 0, width: 520, wideBottom: true, ...LANDSCAPE });
    expect(four.size, "a 2x2 card has more room per slot than the old fixed 133").toBeGreaterThan(
      QUICK_TEMPERATURE_SIZE,
    );
    expect(four.size).toBeLessThanOrEqual(QUICK_DIAL_MAX);
    // The dial fills the slot it was given: a taller row of the same width is a
    // bigger dial.
    const shorter = quickSlotLayout({ count: 4, dials: 4, readings: 0, height: 340, portrait: false, wideBottom: true, width: 520 });
    expect(shorter.size).toBeLessThan(four.size);
  });

  it("never draws a dial below the knob's own floor", () => {
    // Five knobs in a kiosk column: the slots are wide enough for the floor size
    // and no bigger, and the card does not shrink them away to fit.
    const kiosk = quickSlotLayout({ ...FULL_CARD, width: 520, wideBottom: true, ...LANDSCAPE });
    expect(kiosk.size).toBeGreaterThanOrEqual(TEMPERATURE_ENCODER_MIN_SIZE);
    // A card far too narrow for any of it still draws the floor size.
    expect(quickSlotLayout({ ...FULL_CARD, width: 120, wideBottom: true, ...PORTRAIT }).size).toBe(TEMPERATURE_ENCODER_MIN_SIZE);
  });

  it("reserves a knob's rings in portrait and its box in landscape", () => {
    // Portrait keeps the rings on screen, so a slot is as wide as their reach.
    const portrait = quickSlotLayout({ count: 1, dials: 1, readings: 0, width: 640, wideBottom: true, ...PORTRAIT });
    expect(quickDialSlot(portrait.size)).toBeLessThanOrEqual(portrait.slot);
    // Landscape lets them float over the page, so the dial's box is the measure.
    const landscape = quickSlotLayout({ count: 1, dials: 1, readings: 0, width: 496, wideBottom: true, ...LANDSCAPE });
    expect(quickDialBox(landscape.size)).toBeLessThanOrEqual(landscape.slot);
  });

  it("keeps the readings tile's own measure when no dial is placed", () => {
    const readings = quickSlotLayout({ count: 1, dials: 0, readings: 1, width: 400, wideBottom: false, ...PORTRAIT });
    expect(readings.slot).toBeGreaterThanOrEqual(QUICK_READINGS_MIN);
  });
});
