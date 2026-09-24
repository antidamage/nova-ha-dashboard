import { describe, expect, it } from "vitest";
import {
  PANEL_SLOT_GAP_MAX,
  PANEL_SLOT_GAP_MIN,
  balancedColumns,
  panelSlotGrid,
  slotGap,
  slotWidth,
} from "./panelSlots";

describe("the arrangement a panel of slots uses", () => {
  it("is the balanced grid once there are four or more", () => {
    expect(balancedColumns(1, false)).toBe(1);
    expect(balancedColumns(4, false)).toBe(2);
    expect(balancedColumns(4, true)).toBe(2);
    expect(balancedColumns(5, false)).toBe(3);
    expect(balancedColumns(6, true)).toBe(3);
    expect(balancedColumns(9, false)).toBe(3);
    expect(balancedColumns(10, false)).toBe(4);
  });

  it("is one line along the panel's long axis for two or three", () => {
    // Adeline, 2026-09-25: "if there are two components, follow the same rules
    // for a 1x2 or 2x1 area depending on layout orientation. continue this
    // pattern."
    for (const count of [2, 3]) {
      const across = panelSlotGrid({ count, minWidth: 40, portrait: false, width: 900 });
      expect([across.columns, across.rows], `${count} in a wide panel`).toEqual([count, 1]);
      const down = panelSlotGrid({ count, minWidth: 40, portrait: true, width: 900 });
      expect([down.columns, down.rows], `${count} in a tall panel`).toEqual([1, count]);
    }
  });
});

describe("the grid a panel lays its slots out in", () => {
  it("gives four slots a 2x2 where the panel has room for it", () => {
    const grid = panelSlotGrid({ count: 4, minWidth: 159, portrait: false, width: 520 });
    expect([grid.columns, grid.rows]).toEqual([2, 2]);
    expect(grid.slot).toBeGreaterThanOrEqual(159);
  });

  it("keeps the balanced grid while its slots meet the panel's minimum", () => {
    // The card the demo ships, in a landscape column 520px wide: three columns
    // of slots hold the five components in two rows, which is what fits the
    // column's height at 2x3's expense.
    const grid = panelSlotGrid({ count: 5, minWidth: 159, portrait: false, width: 520 });
    expect([grid.columns, grid.rows]).toEqual([3, 2]);
    expect(grid.slot).toBeGreaterThanOrEqual(159);
  });

  it("narrows a column at a time rather than let a slot fall under the minimum", () => {
    // A phone in portrait: two ring-bearing knobs side by side do not fit, and
    // nor do three, so the card there is one column of five.
    const phone = panelSlotGrid({ count: 5, minWidth: 268, portrait: true, width: 343 });
    expect([phone.columns, phone.rows]).toEqual([1, 5]);
    expect(phone.slot).toBeCloseTo(343, 1);

    // A tablet's portrait width holds two of those slots but not three.
    const tablet = panelSlotGrid({ count: 5, minWidth: 268, portrait: true, width: 772 });
    expect([tablet.columns, tablet.rows]).toEqual([2, 3]);

    // A wide short panel: the line it would otherwise be is not wide enough for
    // the slots it holds, so it gives up nothing and keeps the grid.
    const short = panelSlotGrid({ count: 5, minWidth: 159, portrait: false, width: 520 });
    expect(short.columns).toBe(3);
  });

  it("fills the panel's width exactly, whatever the column count", () => {
    for (let width = 200; width <= 2400; width += 7) {
      for (const portrait of [true, false]) {
        for (const count of [1, 2, 3, 4, 5, 6, 9, 12]) {
          const minWidth = portrait ? 268 : 159;
          const grid = panelSlotGrid({ count, minWidth, portrait, width });
          const used = grid.columns * grid.slot + (grid.columns - 1) * grid.gap;
          // Each slot is rounded DOWN, so a row of them is the width it was
          // given to within a hundredth of a pixel each — and never over it,
          // which would wrap the last slot onto a row of its own.
          expect(used, `${count} in ${width}px portrait=${portrait} is filled`).toBeLessThanOrEqual(width + 0.001);
          expect(used, `${count} in ${width}px portrait=${portrait} is filled`).toBeGreaterThan(
            width - 0.01 * grid.columns - 0.001,
          );
          // A slot is never narrower than the panel's own minimum, unless the
          // panel is narrower than one slot and there is nowhere left to go.
          if (grid.columns > 1) {
            expect(grid.slot, `${count} in ${width}px portrait=${portrait} holds its minimum`).toBeGreaterThanOrEqual(
              minWidth,
            );
          }
        }
      }
    }
  });

  it("needs no measurement to be shaped", () => {
    const unmeasured = panelSlotGrid({ count: 5, minWidth: 159, portrait: false, width: 0 });
    expect([unmeasured.columns, unmeasured.rows]).toEqual([1, 5]);
    expect(unmeasured.slot).toBe(0);
    expect(panelSlotGrid({ count: 0, minWidth: 159, portrait: false, width: 520 }).columns).toBe(0);
  });
});

describe("the gap between slots", () => {
  it("is a share of the slot, within the floor and the ceiling", () => {
    expect(slotGap(100)).toBe(PANEL_SLOT_GAP_MIN);
    expect(slotGap(300)).toBe(15);
    expect(slotGap(2000)).toBe(PANEL_SLOT_GAP_MAX);
    // A column given more width takes a wider gap with it.
    const narrow = panelSlotGrid({ count: 4, minWidth: 40, portrait: false, width: 400 });
    const wide = panelSlotGrid({ count: 4, minWidth: 40, portrait: false, width: 1200 });
    expect(wide.gap).toBeGreaterThan(narrow.gap);
    expect(slotWidth(2, 400, narrow.gap)).toBeCloseTo(narrow.slot, 1);
  });
});
