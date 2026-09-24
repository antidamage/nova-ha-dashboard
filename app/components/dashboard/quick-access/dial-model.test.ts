import { describe, expect, it } from "vitest";
import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";
import {
  PORTRAIT_QUERY,
  QUICK_DIAL_MAX,
  QUICK_ENCODER_SIZE,
  QUICK_PRESET_BAND,
  QUICK_READINGS_MIN,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDEST_RINGS,
  quickDialBox,
  quickDialSizeForCell,
  quickDialSlot,
  quickSlotHeight,
  quickSlotLayout,
} from "./dial-model";

/** The card the demo ships: four dials and the readings tile. */
const FULL_CARD = { count: 5, dials: 4, readings: 1 };
/** A landscape card's content box: a 520px column of the page's own height. */
const LANDSCAPE = { height: 562, portrait: false };
/** Portrait: the card is as tall as its content, so it has no height to divide. */
const PORTRAIT = { height: 0, portrait: true };

describe("the card's grid", () => {
  it("gives four slots a 2x2 where the card has room for it", () => {
    const layout = quickSlotLayout({ ...FULL_CARD, count: 4, dials: 4, readings: 0, width: 520, ...LANDSCAPE });
    expect([layout.columns, layout.rows]).toEqual([2, 2]);
    // Two slots and the gap between them are the card's whole width.
    expect(2 * layout.slot + layout.gap).toBeCloseTo(520, 0);
  });

  it("holds the balanced grid for five, and the card's own minimum for a slot", () => {
    const layout = quickSlotLayout({ ...FULL_CARD, width: 520, ...LANDSCAPE });
    expect([layout.columns, layout.rows]).toEqual([3, 2]);
    expect(layout.slot).toBeGreaterThanOrEqual(quickDialBox(TEMPERATURE_ENCODER_MIN_SIZE));
  });

  it("goes to one column where the card cannot hold two slots", () => {
    // A phone in portrait: two ring-bearing knobs side by side would run their
    // opened rings off the screen, so the card is five rows.
    const phone = quickSlotLayout({ ...FULL_CARD, width: 343, ...PORTRAIT });
    expect([phone.columns, phone.rows]).toEqual([1, 5]);
    expect(phone.slot).toBeCloseTo(343, 1);
    // A tablet's portrait width holds two of them, and three only just miss.
    const tablet = quickSlotLayout({ ...FULL_CARD, width: 772, ...PORTRAIT });
    expect(tablet.columns).toBe(2);
  });

  it("is one line for two or three components, along the panel's long axis", () => {
    expect(quickSlotLayout({ count: 2, dials: 2, readings: 0, width: 520, ...LANDSCAPE }).columns).toBe(2);
    expect(quickSlotLayout({ count: 2, dials: 2, readings: 0, width: 520, ...PORTRAIT }).rows).toBe(2);
    expect(quickSlotLayout({ count: 3, dials: 3, readings: 0, width: 520, ...LANDSCAPE }).columns).toBe(3);
    expect(quickSlotLayout({ count: 3, dials: 3, readings: 0, width: 520, ...PORTRAIT }).columns).toBe(1);
  });

  it("fills the card's width whatever the arrangement", () => {
    for (const width of [319, 343, 440, 520, 772, 1000, 1920]) {
      for (const portrait of [true, false]) {
        const layout = quickSlotLayout({ ...FULL_CARD, height: portrait ? 0 : 562, portrait, width });
        const used = layout.columns * layout.slot + (layout.columns - 1) * layout.gap;
        expect(used, `${width}px portrait=${portrait} fills the card`).toBeCloseTo(width, 0);
      }
    }
  });

  it("needs no measurement to be shaped", () => {
    const unmeasured = quickSlotLayout({ ...FULL_CARD, ...LANDSCAPE, width: 0 });
    expect(unmeasured.columns).toBe(1);
    expect(unmeasured.slot).toBe(0);
    expect(unmeasured.size).toBe(QUICK_TEMPERATURE_SIZE);
  });
});

describe("the dial a slot gets", () => {
  it("scales up to fill the room a four-slot card has", () => {
    const four = quickSlotLayout({ ...FULL_CARD, count: 4, dials: 4, readings: 0, width: 520, ...LANDSCAPE });
    expect(four.size, "a 2x2 card has more room per slot than the old fixed 133").toBeGreaterThan(
      QUICK_TEMPERATURE_SIZE,
    );
    expect(four.size).toBeLessThanOrEqual(QUICK_DIAL_MAX);
    // The dial fills the slot it was given: a taller row of the same width is a
    // bigger dial.
    const shorter = quickSlotLayout({ ...FULL_CARD, count: 4, dials: 4, readings: 0, height: 340, portrait: false, width: 520 });
    expect(shorter.size).toBeLessThan(four.size);
  });

  it("never draws a dial below the knob's own floor", () => {
    // Five knobs in a kiosk column: the slots are wide enough for the floor size
    // and no bigger, and the card does not shrink them away to fit.
    const kiosk = quickSlotLayout({ ...FULL_CARD, width: 520, ...LANDSCAPE });
    expect(kiosk.size).toBeGreaterThanOrEqual(TEMPERATURE_ENCODER_MIN_SIZE);
    // A card far too narrow for any of it still draws the floor size.
    expect(quickSlotLayout({ ...FULL_CARD, width: 120, ...PORTRAIT }).size).toBe(TEMPERATURE_ENCODER_MIN_SIZE);
  });

  it("reserves a knob's rings in portrait and its box in landscape", () => {
    // Portrait keeps the rings on screen, so a slot is as wide as their reach.
    const portrait = quickSlotLayout({ count: 1, dials: 1, readings: 0, width: 640, ...PORTRAIT });
    expect(quickDialSlot(portrait.size)).toBeLessThanOrEqual(portrait.slot);
    // Landscape lets them float over the page, so the dial's box is the measure.
    const landscape = quickSlotLayout({ count: 1, dials: 1, readings: 0, width: 496, ...LANDSCAPE });
    expect(quickDialBox(landscape.size)).toBeLessThanOrEqual(landscape.slot);
  });

  it("keeps the readings tile's own measure when no dial is placed", () => {
    const readings = quickSlotLayout({ count: 1, dials: 0, readings: 1, width: 400, ...PORTRAIT });
    expect(readings.slot).toBeGreaterThanOrEqual(QUICK_READINGS_MIN);
  });

  it("knows the height a dial needs: its box, its preset row, and the gap", () => {
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
