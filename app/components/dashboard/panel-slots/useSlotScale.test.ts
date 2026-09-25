import { describe, expect, it } from "vitest";
import { LINE_SLOT_SCALE_MIN, SLOT_SCALE_FLOOR, dialScaleFactor, lineScaleFactor } from "./useSlotScale";

// The two factors a panel's slots draw themselves at (specs/control-modules.md,
// "Every panel holds slots"). The dials stop at a legibility floor and the panel
// scrolls below it; the wide line slot under them has no floor to stop at, because
// stopping is what would leave its end outside the panel — the independent review
// of PR #58 found the line sharing the dials' floor, and a 300px card (the width
// the portrait suite's own narrow phone uses) covers 264px with 384px of readings,
// so it was drawn at its full size and ran past the card's edge.

describe("the factor a dial slot draws itself at", () => {
  it("is one while the slot fits, and the size it needs while it can still be read", () => {
    expect(dialScaleFactor(1)).toBe(1);
    expect(dialScaleFactor(1.4)).toBe(1);
    expect(dialScaleFactor(0.92)).toBe(0.92);
    expect(dialScaleFactor(SLOT_SCALE_FLOOR + 0.001)).toBeCloseTo(0.701, 3);
  });

  it("gives up and lets the panel scroll rather than hiding a control", () => {
    // Below the floor a knob would be too small to read or to hit, so the dial
    // keeps its own size and the panel scrolls (the floor is 100px for a knob).
    expect(dialScaleFactor(SLOT_SCALE_FLOOR)).toBe(1);
    expect(dialScaleFactor(0.5)).toBe(1);
    expect(dialScaleFactor(0.05)).toBe(1);
  });
});

describe("the factor a wide line slot draws itself at", () => {
  it("is one while the line fits", () => {
    expect(lineScaleFactor(1)).toBe(1);
    expect(lineScaleFactor(1.2)).toBe(1);
  });

  it("scales the line to the panel's width below the DIALS' floor", () => {
    // The case the review found: a 300px card's row is 264px and the shipped
    // readings line is 384px across it. The dials' floor would leave the line at
    // full size, 120px past the card; the line's own factor fits it exactly.
    expect(lineScaleFactor(264 / 384)).toBeCloseTo(0.688, 3);
    expect(lineScaleFactor(SLOT_SCALE_FLOOR)).toBe(SLOT_SCALE_FLOOR);
    expect(lineScaleFactor(0.4)).toBe(0.4);
    expect(lineScaleFactor(0.31)).toBe(0.31);
    // It never comes back 1, which is what put the line's end outside the panel.
    for (const needed of [0.69, 0.6, 0.5, 0.31, 0.1]) {
      expect(lineScaleFactor(needed), `${needed} fits the line`).toBeLessThanOrEqual(needed + 0.001);
    }
  });

  it("keeps a sanity clamp, so a degenerate measurement cannot collapse it", () => {
    expect(lineScaleFactor(0)).toBe(LINE_SLOT_SCALE_MIN);
    expect(LINE_SLOT_SCALE_MIN).toBeGreaterThan(0);
  });
});
