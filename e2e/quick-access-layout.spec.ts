import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md: the card is a grid of equal slots — the lighting
// dial, the amplifier dial, the two climate knobs and the readings tile, in the
// order they are placed — and each dial's preset row belongs to the dial above
// it, sitting just under it rather than a knob-slack below (Adeline, 2026-09-22;
// the grid is 2026-09-25).
// QUICK_ACCESS_SHOTS=<dir> keeps a screenshot of the card at each width.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;

for (const width of [1280, 1920]) {
  test(`each dial row sits under its own dial at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await gotoDashboard(page);

    const pairs = page.locator(".quick-access .quick-button-pair");
    await expect(pairs.first()).toBeVisible();
    // Two dial segments carry presets: the lights and the Apple TV. The climate
    // tiles are a temperature knob, whose modes and timer are on the dial
    // itself (Adeline, 2026-09-12, specs/temperature-encoder.md).
    await expect(page.locator(".quick-access .quick-segment-lights .quick-button-pair")).toHaveCount(1);
    await expect(page.locator(".quick-access .quick-segment-appletv .quick-button-pair")).toHaveCount(1);
    await expect(page.locator(".quick-access .quick-segment-climate .quick-button-pair")).toHaveCount(0);
    await expect(page.locator(".quick-access .quick-segment-climate .temperature-encoder").first()).toBeVisible();

    const measured = await pairs.evaluateAll((nodes) => nodes.map((pair) => {
      const segment = pair.closest(".quick-segment");
      const dial = segment?.querySelector(".rotary-encoder-dial")?.getBoundingClientRect() ?? null;
      const box = pair.getBoundingClientRect();
      return {
        segment: segment?.className.replace("quick-segment ", "") ?? "",
        gap: dial ? Math.round(box.top - dial.bottom) : null,
      };
    }));
    expect(measured.map((entry) => entry.segment).sort()).toEqual(["quick-segment-appletv", "quick-segment-lights"]);
    for (const entry of measured) {
      expect(entry.gap, `${entry.segment}: preset row under its dial`).toBeGreaterThanOrEqual(0);
      expect(entry.gap, `${entry.segment}: preset row hugging its dial`).toBeLessThanOrEqual(12);
    }

    // The light dial and the amplifier dial are the first two slots of the grid,
    // so the first three modules share its first row — the light dial, the
    // amplifier dial, then the aircon knob — and the second row opens under the
    // first column (Adeline, 2026-09-25: the card is a grid of equal slots, and
    // the order the slots are placed in is the order they take in it).
    const grid = await page.evaluate(() =>
      [...document.querySelectorAll(".quick-access-row > *")].map((slot) => {
        const box = slot.getBoundingClientRect();
        return { cls: slot.className, left: Math.round(box.left), top: Math.round(box.top) };
      }),
    );
    expect(grid).toHaveLength(5);
    expect(Math.abs(grid[0].top - grid[1].top), "the pair shares a row").toBeLessThanOrEqual(1);
    expect(Math.abs(grid[2].top - grid[0].top), "and so does the first climate knob: three slots, one row")
      .toBeLessThanOrEqual(1);
    expect(grid[3].top - grid[0].top, "the fourth slot opens the row below").toBeGreaterThan(0);
    expect(Math.abs(grid[3].left - grid[0].left), "in the first slot's own column").toBeLessThanOrEqual(1);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator(".quick-access-row").screenshot({ path: path.join(SHOTS, `quick-access-${width}.png`) });
    }
  });
}
