import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, "The layout slots" (Adeline, 2026-09-25): the card
// is a grid of equal slots — one per module placed on it — in a defined
// arrangement, the slots evenly subdivide the card, and the content in a slot is
// CENTRED across it and starts at its TOP.
//
// Which arrangement a card of N slots gets, and how big the dial in a slot is,
// are pure functions and are proved in `panelSlots.test.ts` and
// `dial-model.test.ts`; this is the shipped five-module card in a browser at the
// widths the rule names, including the two it must not break: a phone's single
// column, and a landscape card that fits its column rather than scrolling.
// QUICK_ACCESS_SHOTS=<dir> is honoured by the other two specs, not this one.

const VIEWPORTS = [
  { columns: 3, fits: true, name: "kiosk 1920x1080", rows: 2, width: 1920, height: 1080 },
  { columns: 3, fits: true, name: "desktop 1366x768", rows: 2, width: 1366, height: 768 },
  { columns: 3, fits: true, name: "wide portrait 1080x1920", rows: 2, width: 1080, height: 1920 },
  { columns: 3, fits: true, name: "ipad pro 1024x1366", rows: 2, width: 1024, height: 1366 },
  { columns: 2, fits: true, name: "tablet 820x1180", rows: 3, width: 820, height: 1180 },
  { columns: 1, fits: true, name: "phone 440x956", rows: 5, width: 440, height: 956 },
  { columns: 1, fits: true, name: "phone 375x812", rows: 5, width: 375, height: 812 },
  // The one case that may scroll (Adeline, 2026-09-25: "in all cases except
  // mobile phone we always want all panels on screen at once"): five knobs at
  // the 100px floor need more height than a 393px-tall window gives the column.
  { columns: 3, fits: false, name: "phone landscape 852x393", rows: 2, width: 852, height: 393 },
];

type Slot = {
  cls: string;
  contentTop: number | null;
  dial: number | null;
  h: number;
  leftGap: number | null;
  /** How far the slot's own content reaches down its box. */
  needs: number;
  rightGap: number | null;
  w: number;
  x: number;
  y: number;
};

/**
 * The card draws its row before its slots: the slots arrive with the controls
 * configuration, and their width and the dial sizes are measured from the card a
 * frame or two after that. Waiting on the row's presence alone measures a layout
 * that is still moving.
 */
async function waitForSlots(page: import("@playwright/test").Page) {
  const row = page.locator(".quick-access-row");
  await expect(row).toBeVisible();
  await expect(page.locator(".quick-access-row > *")).toHaveCount(5);
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
    const first = element.firstElementChild;
    return Boolean(first && first.getBoundingClientRect().width > 1);
  });
  await page.waitForTimeout(150);
  await row.scrollIntoViewIfNeeded();
}

/**
 * Every placed slot with the row it actually lands on, so a grid whose last row
 * is short is measured as two rows rather than one. Each slot's first drawn thing
 * is measured from the slot's own CONTENT box, so a tiled segment's border and
 * padding are not read as a control sitting lower than a bare knob's.
 */
async function drawnRows(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    const row = document.querySelector(".quick-access-row");
    if (!row) return null;
    const rowRect = row.getBoundingClientRect();
    const slots: Slot[] = [];
    for (const slot of [...row.children]) {
      const box = slot.getBoundingClientRect();
      const styles = getComputedStyle(slot);
      const inner = box.top + parseFloat(styles.borderTopWidth) + parseFloat(styles.paddingTop);
      const innerLeft = box.left + parseFloat(styles.borderLeftWidth) + parseFloat(styles.paddingLeft);
      const innerWidth = box.width - parseFloat(styles.borderLeftWidth) - parseFloat(styles.paddingLeft)
        - parseFloat(styles.borderRightWidth) - parseFloat(styles.paddingRight);
      // The first thing the slot draws: the dial, or the tile's lead row. The
      // dial is measured as the .rotary-encoder-dial box, never the wrapper
      // around it — the climate knob's wrapper starts at the slot's edge and its
      // dial a title-band lower, and the two must be compared like for like.
      const dialBox = slot.querySelector(".rotary-encoder-dial");
      const content = dialBox ?? slot.querySelector(".temperature-encoder") ?? slot.querySelector(".quick-segment-lead");
      const contentBox = content?.getBoundingClientRect() ?? null;
      // What the slot actually holds, measured from its own top edge: a knob's
      // preset band is a pseudo-element spacer, so the children are the honester
      // measure of what the row has to be tall enough for.
      const needs = [...slot.children].reduce((most, child) => {
        return Math.max(most, child.getBoundingClientRect().bottom - box.top);
      }, 0);
      slots.push({
        cls: slot.className,
        contentTop: contentBox ? round(contentBox.top - inner) : null,
        dial: dialBox ? round(dialBox.getBoundingClientRect().width) : null,
        h: round(box.height),
        leftGap: contentBox ? round(contentBox.left - innerLeft) : null,
        needs: round(needs),
        rightGap: contentBox ? round((innerLeft + innerWidth) - contentBox.right) : null,
        w: round(box.width),
        x: round(box.left - rowRect.left),
        y: round(box.top - rowRect.top),
      });
    }
    const rows = new Map<number, typeof slots>();
    for (const slot of slots) {
      const key = Math.round(slot.y);
      rows.set(key, [...(rows.get(key) ?? []), slot]);
    }
    return {
      columns: Number(getComputedStyle(row).getPropertyValue("--quick-columns")),
      overflowX: row.scrollWidth - row.clientWidth,
      overflowY: row.scrollHeight - row.clientHeight,
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
  test(`the slots are one grid at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");

    const all = drawn.rows.flatMap((row) => row.slots);
    expect(all.length, "the demo card holds five slots").toBe(5);
    expect(drawn.columns, "the card declares the columns its slots use").toBe(viewport.columns);
    expect(drawn.rows.length, "five slots fill the rows below").toBe(viewport.rows);

    // One width for the whole card: a lighting dial, an amplifier dial, a
    // climate knob and the readings tile are all the same slot.
    const widths = all.map((slot) => slot.w);
    expect(Math.min(...widths), "a laid-out slot, not the unmeasured frame").toBeGreaterThan(1);
    expect(Math.max(...widths) - Math.min(...widths), "one slot width").toBeLessThanOrEqual(1);

    // A slot is never cut off: the slots subdivide the card, they do not overflow
    // it.
    expect(drawn.overflowX, "no slot runs past the card's edge").toBeLessThanOrEqual(1);

    // Every row is filled edge to edge, or is the short last row.
    for (const row of drawn.rows) {
      expect(row.slots.length).toBeLessThanOrEqual(viewport.columns);
      const first = row.slots[0];
      const last = row.slots[row.slots.length - 1];
      if (row.slots.length === viewport.columns) {
        expect(first.x, "a full row starts at the row's left edge").toBeLessThanOrEqual(1);
        expect(drawn.rowWidth - (last.x + last.w), "a full row ends at its right edge").toBeLessThanOrEqual(1);
      }
    }

    // Controls are top-aligned in their slot, not centred in it: every dial
    // starts at the same height within its own space, and the readings tile
    // starts at the top of its (short) slot too.
    const dials = all.filter((slot) => slot.dial !== null);
    expect(dials.length, "five slots, four of them dials").toBe(4);
    expect(new Set(dials.map((slot) => slot.dial)).size, "one dial size for the card").toBe(1);
    expect(Math.max(...dials.map((slot) => slot.contentTop ?? 0)) - Math.min(...dials.map((slot) => slot.contentTop ?? 0)))
      .toBeLessThanOrEqual(2);
    for (const top of all.map((slot) => slot.contentTop).filter((value): value is number => value !== null)) {
      expect(top, "content starts at the top of its slot, not in the middle of it").toBeLessThanOrEqual(20);
    }

    // A control is centred in its slot: the width the slot has beyond it is
    // shared equally either side, never left over at the right. The readings tile
    // is not a control and is not covered.
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

    // In landscape the card is a column of a height of its own, so its rows
    // divide that height between them (the slots "evenly subdivide the space
    // available"). Portrait has no height to divide: the card is as tall as its
    // content.
    if (viewport.fits && viewport.width > viewport.height) {
      for (const row of drawn.rows) {
        expect(Math.abs(row.h - drawn.rows[0].h), "the rows are the same height").toBeLessThanOrEqual(1);
      }
    }
  });
}

test("a slot with more room draws a bigger dial", async ({ page }) => {
  // The content scales to its slot (Adeline, 2026-09-25): the same five modules
  // in a 2x3 card's wider slots draw larger dials than a 3x2 card's, and the
  // narrowest card — a kiosk column, where five knobs only fit three to a row —
  // draws the knob's own floor size rather than shrinking past it.
  const sizes: Record<string, number> = {};
  for (const viewport of [
    { name: "820x1180", width: 820, height: 1180 },
    { name: "1920x1080", width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");
    const dials = drawn.rows.flatMap((row) => row.slots).filter((slot) => slot.dial !== null);
    sizes[viewport.name] = dials[0].dial ?? 0;
    // The knob's own floor: a temperature knob's smallest legible size is 100px,
    // which is 131.4px across its dial.
    expect(sizes[viewport.name], `${viewport.name}: never below the knob's floor`).toBeGreaterThanOrEqual(131);
  }
  expect(sizes["820x1180"], "the wider slot draws the bigger dial").toBeGreaterThan(sizes["1920x1080"]);
});

/**
 * The card with FOUR modules on it — the arrangement Adeline named ("on desktop,
 * it will be 2x2"). The demo's own derived controls, from the app itself, with
 * the readings tile taken off; the demo keeps its config in sessionStorage and
 * merges what it finds there over its defaults, so the seed is the whole stored
 * document with only the controls block replaced.
 */
async function seedFourModules(page: import("@playwright/test").Page) {
  const controls = await page.evaluate(async () =>
    (await (await fetch("/api/control-modules")).json()).controls);
  const four = {
    ...controls,
    configured: true,
    presets: controls.presets.filter((preset: { id: string }) => preset.id !== "outside"),
    slots: controls.slots.filter((slot: { presetId: string }) => slot.presetId !== "outside"),
  };
  const stored = await page.evaluate(() => window.sessionStorage.getItem("nova.dashboard.demoConfig.v2"));
  if (!stored) throw new Error("the demo config was not in sessionStorage to seed from");
  const document_ = JSON.parse(stored);
  document_.dashboard.controls = four;
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("nova.dashboard.demoConfig.v2", JSON.stringify(value));
  }, document_);
  await page.reload({ waitUntil: "domcontentloaded" });
}

test("four modules are the 2x2, and it fits the card", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedFourModules(page);
  await expect(page.locator(".quick-access-row > *")).toHaveCount(4);
  await page.waitForFunction(() => {
    const element = document.querySelector(".quick-access-row");
    if (!element) return false;
    return parseFloat(getComputedStyle(element).getPropertyValue("--quick-slot")) > 0;
  });
  const drawn = await drawnRows(page);
  if (!drawn) throw new Error("no .quick-access-row");

  expect(drawn.columns, "four modules are two columns").toBe(2);
  expect(drawn.rows.length, "and two rows").toBe(2);
  expect(drawn.overflowY, "a 2x2 card fits its column").toBeLessThanOrEqual(1);
  for (const row of drawn.rows) {
    expect(row.slots.length, "both rows are full").toBe(2);
    expect(Math.abs(row.h - drawn.rows[0].h), "the rows are the same height").toBeLessThanOrEqual(1);
    for (const slot of row.slots) {
      // Each slot holds what it draws: the knob's own preset band is inside the
      // row it was given, which is what the measure has to account for.
      expect(slot.needs, `${slot.cls}: content inside its slot`).toBeLessThanOrEqual(row.h + 1);
    }
  }
  const dials = drawn.rows.flatMap((row) => row.slots).filter((slot) => slot.dial !== null);
  expect(new Set(dials.map((slot) => slot.dial)).size, "one dial size for the card").toBe(1);
});
