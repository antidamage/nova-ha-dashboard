import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";
import { drawnRows, waitForSlots } from "./quick-access-slots.fixtures";

// specs/quick-access-card.md, "The layout slots" (Adeline, 2026-09-25): the card
// is a grid of DIAL slots — 2x2 for four "if there's room, or a 1x4 grid if there
// isn't" — with "a wide slot at the bottom" for every module that is not a dial,
// drawn as ONE line and collapsed when nothing is placed in it.
//
// Which arrangement a card of N dials gets, and how tall its line is, are pure
// functions and are proved in `panelSlots.test.ts` and `slot-layout.test.ts`; this
// is the shipped five-module card in a browser at the widths the rule names,
// including the two it must not break: a phone's single column, and a landscape
// card that fits its column rather than scrolling.
//
// Every figure below is measured, not derived: QUICK_ACCESS_SHOTS=<dir> is honoured
// by the other two specs, not this one.
//
// Dial sizes against slot room, and the card with nothing on its line, are in
// quick-access-slots.sizes.spec.ts.

const VIEWPORTS = [
  { columns: 2, dialRows: 2, fits: true, height: 1080, name: "kiosk 1920x1080", width: 1920 },
  { columns: 2, dialRows: 2, fits: true, height: 768, name: "desktop 1366x768", width: 1366 },
  { columns: 2, dialRows: 2, fits: true, height: 1920, name: "wide portrait 1080x1920", width: 1080 },
  { columns: 2, dialRows: 2, fits: true, height: 1366, name: "ipad pro 1024x1366", width: 1024 },
  { columns: 2, dialRows: 2, fits: true, height: 1180, name: "tablet 820x1180", width: 820 },
  { columns: 1, dialRows: 4, fits: true, height: 956, name: "phone 440x956", width: 440 },
  { columns: 1, dialRows: 4, fits: true, height: 812, name: "phone 375x812", width: 375 },
  // The one case that may scroll (Adeline, 2026-09-25: "in all cases except
  // mobile phone we always want all panels on screen at once"): four knobs in two
  // columns at the 100px floor, plus the line, need more height than a 393px-tall
  // window gives the column.
  { columns: 2, dialRows: 2, fits: false, height: 393, name: "phone landscape 852x393", width: 852 },
];

/** The card's own height a line slot may take: one line, and the row's gap. */
const LINE_SLOT_MAX = 58;

for (const viewport of VIEWPORTS) {
  test(`the dial grid and its line at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");

    const all = drawn.rows.flatMap((row) => row.slots);
    expect(all.length, "the demo card holds five slots").toBe(5);
    expect(drawn.columns, "the card declares the columns its slots use").toBe(viewport.columns);

    const lines = all.filter((slot) => slot.cls.includes("panel-slot-wide"));
    const dials = all.filter((slot) => slot.dial !== null);
    expect(dials.length, "four of the five slots are DIAL slots").toBe(4);
    expect(lines.length, "and the fifth is the wide line slot").toBe(1);

    // The line is last, and it is one row of the card's whole width: the module
    // that is not a dial does not take a column off the dials (2026-09-25).
    const line = lines[0];
    expect(line.y, "the line sits under the dials").toBeGreaterThan(Math.max(...dials.map((slot) => slot.y)));
    expect(line.layoutW, "the line is the card's whole width").toBeCloseTo(drawn.rowWidth, 0);
    expect(line.x, "the line starts at the card's left edge").toBeLessThanOrEqual(1);
    expect(line.h, "and it is ONE line tall").toBeLessThanOrEqual(LINE_SLOT_MAX);
    // Drawn ACROSS that line rather than as a column of words: the three readings'
    // captions share one row, their numbers the row under them, and every word is
    // inside the one line the slot was given.
    expect(new Set(line.captionTops).size, "the readings' captions sit on one row").toBe(1);
    expect(new Set(line.valueTops).size, "and their values on the row under them").toBe(1);
    expect(line.textRoom, "all of it inside the one line the slot is").toBeGreaterThanOrEqual(-1);
    expect(line.x + line.w, "the line is inside the card").toBeLessThanOrEqual(drawn.rowWidth + 1);

    // The dials are the grid: two columns of two on a desktop, kiosk, iPad and
    // wide portrait screen, and one column of four on a phone.
    const dialRows = new Map<number, typeof dials>();
    for (const slot of dials) {
      const key = Math.round(slot.y);
      dialRows.set(key, [...(dialRows.get(key) ?? []), slot]);
    }
    expect(dialRows.size, "the dials fill the rows below").toBe(viewport.dialRows);
    for (const [, inRow] of dialRows) {
      expect(inRow.length, "every dial row is full").toBe(viewport.columns);
    }
    expect(drawn.rows.length, "and the line is the row after them").toBe(viewport.dialRows + 1);

    // One width for the whole card: a lighting dial, an amplifier dial and a
    // climate knob are all the same slot. (The line is the card's width, not a
    // slot's.)
    const slotWidths = dials.map((slot) => slot.w);
    expect(Math.min(...slotWidths), "a laid-out slot, not the unmeasured frame").toBeGreaterThan(1);
    expect(Math.max(...slotWidths) - Math.min(...slotWidths), "one slot width").toBeLessThanOrEqual(1);

    // A slot is never cut off: the slots subdivide the card, they do not overflow
    // it.
    expect(drawn.overflowX, "nothing runs past the card's edge").toBeLessThanOrEqual(1);

    // Every dial row is filled edge to edge.
    for (const row of drawn.rows) {
      if (row.slots.includes(line)) continue;
      const first = row.slots[0];
      const last = row.slots[row.slots.length - 1];
      expect(first.x, "a full row starts at the row's left edge").toBeLessThanOrEqual(1);
      expect(drawn.rowWidth - (last.x + last.w), "a full row ends at its right edge").toBeLessThanOrEqual(1);
    }

    // Controls are top-aligned in their slot, not centred in it: every dial
    // starts at the same height within its own space, right under its own title
    // band. The band is a share of the dial, so the tolerance is too — the fixed
    // 20px this replaced was measured on a 100px knob, and the card now draws a
    // 200px one whose band is twice as tall. A dial centred in its slot instead
    // sits about a quarter of the way down and fails this.
    expect(new Set(dials.map((slot) => slot.dial)).size, "one dial size for the card").toBe(1);
    expect(Math.max(...dials.map((slot) => slot.contentTop ?? 0)) - Math.min(...dials.map((slot) => slot.contentTop ?? 0)))
      .toBeLessThanOrEqual(2);
    for (const slot of dials) {
      expect(slot.contentTop, `${slot.cls}: content at the top of its slot, not in the middle of it`)
        .toBeLessThanOrEqual((slot.dial ?? 0) * 0.12);
    }

    // A dial is centred in its slot: the width the slot has beyond it is shared
    // equally either side, never left over at the right. The readings tile is not
    // a control and is not covered.
    for (const slot of dials) {
      expect(slot.leftGap, "content has a left gap to measure").not.toBeNull();
      expect(Math.abs((slot.leftGap ?? 0) - (slot.rightGap ?? 0)), `${slot.cls}: centred in its slot`)
        .toBeLessThanOrEqual(1);
    }

    // THE criterion for Adeline's "in all cases except mobile phone we always
    // want all panels on screen at once" (2026-09-25): the card's slots fit the
    // column, not a scroll away from it. This assertion is the one that would
    // have caught the measure being short by a climate knob's preset band — a
    // 2x2 card came to 619px of content inside a 598px column with the scrollbar
    // hidden — and an assertion skipped whenever the card overflows is not one.
    if (viewport.fits) {
      expect(drawn.overflowY, `${viewport.name}: the card fits its column`).toBeLessThanOrEqual(1);
    }

    // In landscape the card is a column of a height of its own, so its dial rows
    // divide that height between them (the slots "evenly subdivide the space
    // available"). The wide line is NOT one of those shares — it is one line of
    // its own, and the dials divide what is left. Portrait has no height to
    // divide: the card is as tall as its content.
    if (viewport.fits && viewport.width > viewport.height) {
      const dialRows = drawn.rows.filter((row) => !row.slots.includes(line)).map((row) => row.h);
      for (const height of dialRows) {
        expect(Math.abs(height - dialRows[0]), "the dial rows are the same height").toBeLessThanOrEqual(1);
      }
      expect(line.h, "and the line is one line, not a share of them").toBeLessThan(dialRows[0]);
    }
  });
}
