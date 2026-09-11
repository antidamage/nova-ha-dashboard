import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md: within a tile everything clusters from the left,
// and the buttons sit beside the control they belong to — the lights dial, the
// climate stepper — not pinned to the tile's right edge (Adeline, 2026-09-11).
// QUICK_ACCESS_SHOTS=<dir> keeps a screenshot of the card at each width.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;
/** `.quick-segment`'s column gap. */
const SEGMENT_GAP_PX = 14;

for (const width of [1280, 1920]) {
  test(`buttons sit beside their control at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await gotoDashboard(page);
    const pairs = page.locator(".quick-segment .quick-button-pair");
    await expect(pairs.first()).toBeVisible();
    const count = await pairs.count();
    // The lights segment and at least one climate segment (the demo home's).
    await expect(page.locator(".quick-segment-lights .quick-button-pair")).toHaveCount(1);
    await expect(page.locator(".quick-segment-climate .quick-button-pair").first()).toBeVisible();

    for (let index = 0; index < count; index += 1) {
      const measured = await pairs.nth(index).evaluate((pair) => {
        const control = pair.previousElementSibling as HTMLElement;
        const box = pair.getBoundingClientRect();
        const before = control.getBoundingClientRect();
        return {
          segment: pair.parentElement?.getAttribute("aria-label"),
          sameLine: box.top < before.bottom && before.top < box.bottom,
          gap: box.left - before.right,
        };
      });
      // A wrapped pair starts its own line at the left; on the same line it
      // follows its control at the ordinary gap.
      if (measured.sameLine) {
        expect(measured.gap, `${measured.segment}: gap before buttons`).toBeLessThanOrEqual(SEGMENT_GAP_PX + 1);
      }
    }

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator(".quick-access-row").screenshot({ path: path.join(SHOTS, `quick-access-${width}.png`) });
    }
  });
}
