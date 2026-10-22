// The slot waits and measurements shared by the Quick Access slot e2e specs
// (quick-access-slots.spec.ts and quick-access-slots.sizes.spec.ts). It is
// deliberately not a `*.spec.ts` file: Playwright collects those by glob, and a
// helper must not be collected as a spec of its own.
import { expect } from "@playwright/test";

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
  /** How far the slot is drawn moved across by the dials' even spread. */
  shift: number;
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
export async function waitForSlots(page: import("@playwright/test").Page, count = 5) {
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
export async function drawnRows(page: import("@playwright/test").Page) {
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
        // How far the slot is drawn moved across by the dials' even spread.
        shift: round(parseFloat(styles.translate) || 0),
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
