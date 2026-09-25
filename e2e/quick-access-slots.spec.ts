import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

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

type Slot = {
  cls: string;
  contentTop: number | null;
  dial: number | null;
  h: number;
  /** The box the layout gave it, before any scale the slot draws itself with. */
  layoutW: number;
  leftGap: number | null;
  /** How far the slot's own content reaches down its box. */
  needs: number;
  rightGap: number | null;
  /** The heights the slot's own readings' captions sit at. */
  captionTops: number[];
  /** How far the slot's own text reaches below the box it was given (negative). */
  textRoom: number;
  /** The heights the slot's own readings' numbers sit at. */
  valueTops: number[];
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
async function waitForSlots(page: import("@playwright/test").Page, count = 5) {
  const row = page.locator(".quick-access-row");
  await expect(row).toBeVisible();
  await expect(page.locator(".quick-access-row > *")).toHaveCount(count);
  // Measured, and the slots laid out at that width. The card leaves
  // `--slot-width` unset until it has measured itself, so an unset (or a
  // non-positive) value here means the width sweep would be measuring the frame
  // before the layout exists — which is what a bare "is it non-empty" check
  // missed, since a measured zero is non-empty too (found in review).
  await page.waitForFunction(() => {
    const element = document.querySelector(".quick-access-row");
    if (!element) return false;
    const slot = parseFloat(getComputedStyle(element).getPropertyValue("--slot-width"));
    if (!Number.isFinite(slot) || slot <= 0) return false;
    const first = element.firstElementChild;
    return Boolean(first && first.getBoundingClientRect().width > 1);
  });
  await page.waitForTimeout(200);
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
    const scale = parseFloat(getComputedStyle(row).getPropertyValue("--wide-scale")) || 1;
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
      // The rows the module's own readings sit on: a module drawn across one line
      // has its captions on one row and their numbers on the one under them, and
      // nothing else below.
      const words = [...slot.querySelectorAll(".quick-segment-title, .quick-segment-state, .quick-stepper-caption, .quick-current-number")];
      const tops = (selector: string) =>
        [...new Set(words.filter((node) => node.matches(selector)).map((node) => Math.round(node.getBoundingClientRect().top)))];
      const textRoom = words.reduce(
        (least, node) => Math.min(least, box.bottom - node.getBoundingClientRect().bottom),
        Number.POSITIVE_INFINITY,
      );
      slots.push({
        captionTops: tops(".quick-stepper-caption"),
        cls: slot.className,
        contentTop: contentBox ? round(contentBox.top - inner) : null,
        dial: dialBox ? round(dialBox.getBoundingClientRect().width) : null,
        h: round(box.height),
        // A line slot that cannot fit the card's width draws itself smaller
        // (`--wide-scale`), and the box it was GIVEN is that divided back out.
        layoutW: round(box.width / scale),
        leftGap: contentBox ? round(contentBox.left - innerLeft) : null,
        needs: round(needs),
        rightGap: contentBox ? round((innerLeft + innerWidth) - contentBox.right) : null,
        textRoom: Number.isFinite(textRoom) ? round(textRoom) : 0,
        valueTops: tops(".quick-current-number"),
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
      columns: Number(getComputedStyle(row).getPropertyValue("--slot-columns")),
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

test("a slot with more room draws a bigger dial", async ({ page }) => {
  // The content scales to its slot (Adeline, 2026-09-25): the same five modules
  // in a 2x2 card's wider slots draw larger dials than the kiosk's, and the
  // card's dials never shrink below the knob's own floor however narrow it gets.
  const sizes: Record<string, number> = {};
  for (const viewport of [
    { name: "820x1180", width: 820, height: 1180 },
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "375x812", width: 375, height: 812 },
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
  // And the dial the card draws at 520px has grown past the floor the old 3x2
  // arrangement was pinned to.
  expect(sizes["1920x1080"], "roomier per dial than the 3x2 the card used to draw").toBeGreaterThan(140);
});

/**
 * The card with FOUR modules on it — the arrangement Adeline named. The demo's
 * own derived controls, from the app itself, with the readings tile taken off; the
 * demo keeps its config in sessionStorage and merges what it finds there over its
 * defaults, so the seed is the whole stored document with only the controls block
 * replaced.
 */
async function seedWithoutReadings(page: import("@playwright/test").Page) {
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

test("with nothing on the line it collapses, and the dials take the whole card", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedWithoutReadings(page);
  await waitForSlots(page, 4);
  const drawn = await drawnRows(page);
  if (!drawn) throw new Error("no .quick-access-row");

  // Four dials and no line at all: no slot, no row, nothing reserved for it.
  expect(page.locator(".quick-access-row > .panel-slot-wide"), "the line is not there").toHaveCount(0);
  expect(drawn.columns, "four dials are two columns").toBe(2);
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
  // The dials divide the whole card rather than a third of it: roomier than the
  // same card with a line under them.
  expect(dials[0].dial, "no height given away to a line that is not there").toBeGreaterThan(160);
});
