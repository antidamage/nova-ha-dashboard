import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, the layout slots (Adeline, 2026-09-23): every
// module placed on the card gets a slot of the same width, the slots fill the
// line they are on with an even gap, the columns of one row line up with the
// columns of the next, and each control sits at the TOP of its own slot rather
// than centred in it.
// QUICK_ACCESS_SHOTS=<dir> is honoured by the other two specs, not this one.

const VIEWPORTS = [
  { name: "kiosk 1920x1080", width: 1920, height: 1080, columns: 2 },
  { name: "wide portrait 1080x1920", width: 1080, height: 1920, columns: 2 },
  { name: "tablet 820x1180", width: 820, height: 1180, columns: 2 },
  { name: "phone 440x956", width: 440, height: 956, columns: 1 },
  { name: "phone 375x812", width: 375, height: 812, columns: 1 },
];

type Slot = {
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  contentTop: number | null;
  leftGap: number | null;
  rightGap: number | null;
  dial: boolean;
};

/**
 * The card draws its row before its slots: the slots arrive with the controls
 * configuration, and their width and the dial sizes are measured from the card
 * a frame or two after that. Waiting on the row's presence alone measures a
 * layout that is still moving.
 */
async function waitForSlots(page: import("@playwright/test").Page) {
  // Auto-retrying assertions, because the demo dashboard re-renders as state
  // arrives and an eagerly-resolved scroll can find the row detached.
  const row = page.locator(".quick-access-row");
  await expect(row).toBeVisible();
  await expect(page.locator(".quick-access-row .quick-segment, .quick-access-row .quick-climate")).toHaveCount(5);
  // Measured, and the slots laid out at that width. The card leaves
  // `--quick-slot` unset until it has measured itself, so an unset (or a
  // non-positive) value here means the width sweep would be measuring the frame
  // before the layout exists — which is what a bare "is it non-empty" check
  // missed, since a measured zero is non-empty too (found in review).
  await page.waitForFunction(() => {
    const element = document.querySelector(".quick-access-row");
    if (!element) return false;
    const slot = parseFloat(getComputedStyle(element).getPropertyValue("--quick-slot"));
    if (!Number.isFinite(slot) || slot <= 0) return false;
    const first = element.querySelector(".quick-segment, .quick-climate");
    return Boolean(first && first.getBoundingClientRect().width > 1);
  });
  await page.waitForTimeout(150);
  await row.scrollIntoViewIfNeeded();
}

/**
 * Every placed slot with the row it actually lands on, so a line whose slots
 * wrapped onto a second row is measured as two rows rather than one line. Each
 * slot's first drawn thing is measured from the slot's own CONTENT box, so a
 * tiled segment's border and padding are not read as a control sitting lower
 * than a bare knob's.
 */
async function drawnRows(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const row = document.querySelector(".quick-access-row");
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const slots: Array<Slot & { line: string }> = [];
    for (const line of [...row.children]) {
      for (const slot of [...line.children]) {
        const box = slot.getBoundingClientRect();
        const styles = getComputedStyle(slot);
        const inner = box.top + parseFloat(styles.borderTopWidth) + parseFloat(styles.paddingTop);
        const innerLeft = box.left + parseFloat(styles.borderLeftWidth) + parseFloat(styles.paddingLeft);
        const innerWidth = box.width - parseFloat(styles.borderLeftWidth) - parseFloat(styles.paddingLeft)
          - parseFloat(styles.borderRightWidth) - parseFloat(styles.paddingRight);
        // The first thing the slot draws: the dial, or the tile's lead row. The
        // dial is measured as the .rotary-encoder-dial box, never the wrapper
        // around it — the climate knob's wrapper starts at the slot's edge and
        // its dial a title-band lower, and the two must be compared like for like.
        const dialBox = slot.querySelector(".rotary-encoder-dial");
        const content = dialBox ?? slot.querySelector(".temperature-encoder") ?? slot.querySelector(".quick-segment-lead");
        const contentBox = content?.getBoundingClientRect() ?? null;
        slots.push({
          cls: slot.className,
          contentTop: contentBox ? round(contentBox.top - inner) : null,
          dial: dialBox !== null,
          leftGap: contentBox ? round(contentBox.left - innerLeft) : null,
          rightGap: contentBox ? round((innerLeft + innerWidth) - contentBox.right) : null,
          h: round(box.height),
          line: line.className.replace("quick-line ", ""),
          w: round(box.width),
          x: round(box.left - rowRect.left),
          y: round(box.top - rowRect.top),
        });
      }
    }
    const rows = new Map<number, typeof slots>();
    for (const slot of slots) {
      const key = Math.round(slot.y);
      rows.set(key, [...(rows.get(key) ?? []), slot]);
    }
    return {
      rowWidth: round(rowRect.width),
      rows: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([y, inRow]) => ({
        h: inRow[0].h,
        slots: inRow.sort((a, b) => a.x - b.x),
        y,
      })),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`every slot is the same width and its row is filled at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");

    const all = drawn.rows.flatMap((row) => row.slots);
    expect(all.length, "the demo card holds five slots").toBe(5);

    // One width for the whole card: a lighting dial, an amplifier dial, a
    // climate knob and the readings tile are all the same slot.
    const widths = all.map((slot) => slot.w);
    expect(Math.min(...widths), "a laid-out slot, not the unmeasured frame").toBeGreaterThan(1);
    expect(Math.max(...widths) - Math.min(...widths), "one slot width").toBeLessThanOrEqual(1);

    // Controls are top-aligned in their slot, not centred in it: every dial
    // starts at the same height within its own space, and the readings tile
    // starts at the top of its (short) slot too.
    const dials = all
      .filter((slot) => slot.dial)
      .map((slot) => slot.contentTop)
      .filter((top): top is number => top !== null);
    expect(dials.length, "five slots, four of them dials").toBe(4);
    expect(Math.max(...dials) - Math.min(...dials), "every dial sits at the same height in its slot").toBeLessThanOrEqual(2);
    for (const top of all.map((slot) => slot.contentTop).filter((value): value is number => value !== null)) {
      expect(top, "content starts at the top of its slot, not in the middle of it").toBeLessThanOrEqual(20);
    }

    // A control is centred in its slot: the width the slot has beyond it is
    // shared equally either side, never left over at the right (Adeline,
    // 2026-09-23). The readings tile is not a control and is not covered.
    for (const slot of all.filter((entry) => entry.dial)) {
      expect(slot.leftGap, `${slot.cls}: content has a left gap to measure`).not.toBeNull();
      expect(
        Math.abs((slot.leftGap ?? 0) - (slot.rightGap ?? 0)),
        `${slot.cls}: the control is centred in its slot`,
      ).toBeLessThanOrEqual(1);
    }

    const full = drawn.rows.filter((row) => row.slots.length === viewport.columns);
    expect(full.length, "the card fills at least one row").toBeGreaterThanOrEqual(1);
    for (const row of drawn.rows) {
      expect(row.slots.length, `${row.slots.length} slots in a row at ${viewport.name}`).toBeLessThanOrEqual(
        viewport.columns,
      );
      for (let index = 1; index < row.slots.length; index += 1) {
        const gap = row.slots[index].x - (row.slots[index - 1].x + row.slots[index - 1].w);
        expect(gap, "an even gap between the slots of a row").toBeGreaterThanOrEqual(7);
      }
    }

    // A full row reaches both edges of the card; a row with fewer slots sits
    // them in the middle (the readings row, and every row on a phone).
    for (const row of drawn.rows) {
      const first = row.slots[0];
      const last = row.slots[row.slots.length - 1];
      if (row.slots.length === viewport.columns) {
        expect(first.x, "a full row starts at the row's left edge").toBeLessThanOrEqual(1);
        expect(drawn.rowWidth - (last.x + last.w), "a full row ends at its right edge").toBeLessThanOrEqual(1);
      } else {
        const before = first.x;
        const after = drawn.rowWidth - (last.x + last.w);
        expect(Math.abs(before - after), "a short row is centred").toBeLessThanOrEqual(1);
      }
    }

    // Full rows put their slots in the same columns: the dials of one row sit
    // directly above the dials of the row below.
    for (const row of full.slice(1)) {
      expect(row.slots.map((slot) => Math.round(slot.x))).toEqual(full[0].slots.map((slot) => Math.round(slot.x)));
    }
  });
}

test("the gap between slots grows with them, and the rows share it", async ({ page }) => {
  // The gap is a share of a slot's width (specs/quick-access-card.md), so the
  // wider a card's slots get the further apart they sit — and the rows are
  // spaced by the same measure rather than by a second, unrelated one.
  const measured: Array<{ columnGap: number; rowGap: number; slot: number; viewport: string }> = [];
  for (const viewport of [
    { name: "landscape 1920x1080", width: 1920, height: 1080 },
    { name: "portrait 1080x1920", width: 1080, height: 1920 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");
    const [first, second] = drawn.rows;
    expect(first.slots).toHaveLength(2);
    measured.push({
      columnGap: Math.round(first.slots[1].x - (first.slots[0].x + first.slots[0].w)),
      rowGap: Math.round(second.y - (first.y + first.h)),
      slot: first.slots[0].w,
      viewport: viewport.name,
    });
  }
  for (const entry of measured) {
    expect(entry.columnGap, `${entry.viewport}: one gap measure`).toBe(entry.rowGap);
  }
  expect(measured[1].slot, "the portrait card's slots are wider").toBeGreaterThan(measured[0].slot);
  expect(measured[1].columnGap, "and their gap grew with them").toBeGreaterThan(measured[0].columnGap);
});
