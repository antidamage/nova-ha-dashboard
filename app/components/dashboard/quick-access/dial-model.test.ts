import { describe, expect, it } from "vitest";
import { ringGeometry } from "../../rotaryEncoderGeometry";
import { TEMPERATURE_ENCODER_MIN_SIZE } from "../../TemperatureEncoder";
import {
  PORTRAIT_QUERY,
  QUICK_ENCODER_SIZE,
  QUICK_READINGS_MIN,
  QUICK_SLOT_GAP_MAX,
  QUICK_SLOT_GAP_MIN,
  QUICK_TEMPERATURE_SIZE,
  QUICK_WIDEST_RINGS,
  quickDialBox,
  quickDialSizeFor,
  quickDialSlot,
  quickSlotLayout,
} from "./dial-model";

/** The card the demo ships: the dial line, two climate knobs, the readings. */
const FULL_CARD = { dials: 4, readings: 1, widestLine: 2 };

describe("the layout slots", () => {
  it("gives every slot on the card the same width, and fills the line", () => {
    for (const width of [496, 740, 1000, 384, 319, 244]) {
      for (const portrait of [true, false]) {
        const layout = quickSlotLayout({ ...FULL_CARD, portrait, width });
        expect(layout.columns, `${width}px portrait=${portrait} holds one or more slots`).toBeGreaterThanOrEqual(1);
        // Neither edge of a full line is left over: the slots and the gaps
        // between them add up to the width the card gave the line.
        const used = layout.columns * layout.slot + (layout.columns - 1) * layout.gap;
        expect(used, `${width}px portrait=${portrait} fills the line`).toBeCloseTo(width, 1);
      }
    }
  });

  it("spaces the slots proportionally, within the floor and the ceiling", () => {
    const narrow = quickSlotLayout({ ...FULL_CARD, portrait: false, width: 300 });
    const wide = quickSlotLayout({ ...FULL_CARD, portrait: false, width: 2000 });
    for (const layout of [narrow, wide]) {
      expect(layout.gap).toBeGreaterThanOrEqual(QUICK_SLOT_GAP_MIN);
      expect(layout.gap).toBeLessThanOrEqual(QUICK_SLOT_GAP_MAX);
    }
    // A wider slot takes a wider gap with it.
    expect(wide.gap).toBeGreaterThan(narrow.gap);
  });

  it("never makes a slot narrower than the widest thing placed in it", () => {
    // Portrait: a slot holds a knob's rings, so they stay on screen.
    const portrait = quickSlotLayout({ ...FULL_CARD, portrait: true, width: 640 });
    expect(portrait.slot).toBeGreaterThanOrEqual(quickDialSlot(portrait.size));
    // Landscape: the rings float over the page, so a dial's box is the measure.
    const landscape = quickSlotLayout({ ...FULL_CARD, portrait: false, width: 496 });
    expect(landscape.slot).toBeGreaterThanOrEqual(quickDialBox(landscape.size));
    expect(landscape.size).toBe(QUICK_TEMPERATURE_SIZE);
  });

  it("scales the slots up rather than leaving the line slack", () => {
    // One column at a phone's width: the slot IS the line.
    const phone = quickSlotLayout({ ...FULL_CARD, portrait: true, width: 319 });
    expect(phone.columns).toBe(1);
    expect(phone.slot).toBeCloseTo(319, 1);
    // The same columns on a wider card give each slot more of the width.
    const wide = quickSlotLayout({ ...FULL_CARD, portrait: true, width: 1000 });
    const narrow = quickSlotLayout({ ...FULL_CARD, portrait: true, width: 638 });
    expect(wide.columns).toBe(narrow.columns);
    expect(wide.slot).toBeGreaterThan(narrow.slot);
  });

  it("holds one column when the card cannot hold two ring-safe slots", () => {
    // 375px phone: two climate knobs side by side would run their opened rings
    // off the screen edge, so the line holds one. The rings' reach plus the gap
    // is what says so.
    const width = 319;
    const size = quickDialSizeFor(width);
    expect(size, "133's rings still fit one slot").toBe(QUICK_TEMPERATURE_SIZE);
    expect(quickDialSlot(size)).toBeLessThanOrEqual(width);
    expect(2 * quickDialSlot(size) + QUICK_SLOT_GAP_MIN, "two ring-safe slots do not fit").toBeGreaterThan(width);
    expect(quickSlotLayout({ ...FULL_CARD, portrait: true, width }).columns).toBe(1);
  });

  it("reserves the readings tile's own measure when no dial is placed", () => {
    const readings = quickSlotLayout({ dials: 0, portrait: true, readings: 1, widestLine: 1, width: 400 });
    expect(readings.slot).toBeGreaterThanOrEqual(QUICK_READINGS_MIN);
    expect(readings.slot).toBeCloseTo(400, 1);
  });

  it("never lets the proportional gap eat into the minimum a slot was measured for", () => {
    // The gap is a share of the slot, so a line given more width takes a wider
    // gap — and the wider gap leaves the slots less room. Picking the column
    // count from the minimum gap alone let the slot fall under it by up to
    // 5.8px (found in review at 1864px with six columns), which in portrait is a
    // knob's opened rings reaching past the slot they were reserved in.
    for (let width = 200; width <= 2400; width += 7) {
      for (const portrait of [true, false]) {
        for (const widestLine of [1, 2, 3, 4, 6]) {
          const layout = quickSlotLayout({ dials: 4, portrait, readings: 1, widestLine, width });
          if (layout.columns === 1) continue; // one slot is the line, nothing to share it with
          const minimum = portrait ? quickDialSlot(layout.size) : quickDialBox(layout.size);
          expect(
            layout.slot,
            `${width}px portrait=${portrait} widestLine=${widestLine} columns=${layout.columns}`,
          ).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  it("needs no measurement to be shaped", () => {
    const unmeasured = quickSlotLayout({ ...FULL_CARD, portrait: false, width: 0 });
    expect(unmeasured.columns).toBe(1);
    expect(unmeasured.size).toBe(QUICK_TEMPERATURE_SIZE);
  });
});

describe("the size the card picks", () => {
  it("is the full 133px on a wide portrait screen", () => {
    expect(quickDialSizeFor(1000)).toBe(QUICK_TEMPERATURE_SIZE);
    expect(QUICK_ENCODER_SIZE).toBe(QUICK_TEMPERATURE_SIZE);
  });

  it("keeps a dial's rings on screen at every size it returns", () => {
    for (const width of [1000, 640, 440, 384, 343, 300, 272]) {
      expect(quickDialSlot(quickDialSizeFor(width))).toBeLessThanOrEqual(Math.max(width, quickDialSlot(100)));
    }
  });

  it("never goes below the 100px floor, even where no size fits", () => {
    // 272px holds a dial at 110: the pair no longer has to share the line, so
    // the dials shrink only when one knob's own rings stop fitting.
    expect(quickDialSizeFor(272)).toBeGreaterThanOrEqual(TEMPERATURE_ENCODER_MIN_SIZE);
    expect(quickDialSizeFor(272)).toBeLessThan(QUICK_TEMPERATURE_SIZE);
    expect(quickDialSizeFor(10)).toBe(TEMPERATURE_ENCODER_MIN_SIZE);
    expect(TEMPERATURE_ENCODER_MIN_SIZE).toBe(100);
  });
});

describe("the layout's constants", () => {
  it("keys portrait on the orientation, and counts the widest knob's rings", () => {
    expect(PORTRAIT_QUERY).toBe("(aspect-ratio <= 1)");
    expect(QUICK_WIDEST_RINGS).toBe(4);
  });

  it("measures a dial's box and its rings from its own geometry", () => {
    expect(quickDialBox(133)).toBeCloseTo(ringGeometry(133, 0, true).titleFootprint, 6);
    expect(quickDialSlot(133)).toBeGreaterThan(quickDialBox(133));
  });
});
