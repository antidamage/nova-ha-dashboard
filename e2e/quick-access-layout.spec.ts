import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md: the card's dials sit on two lines — the lighting
// dial and the amplifier dial on the first, the two climate dials on the next —
// and each dial's preset row belongs to the dial above it, sitting just under
// it rather than a knob-slack below (Adeline, 2026-09-22).
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

    // The pair shares the card's first line, and the climate dials the next.
    const rows = await page.evaluate(() => {
      const centreOf = (selector: string) => {
        const box = document.querySelector(selector)?.querySelector(".rotary-encoder-dial")?.getBoundingClientRect();
        return box ? Math.round(box.top + box.height / 2) : null;
      };
      return {
        lights: centreOf(".quick-access .quick-segment-lights"),
        amp: centreOf(".quick-access .quick-segment-appletv"),
        aircon: centreOf(".quick-access .quick-climate"),
      };
    });
    expect(Math.abs(rows.lights! - rows.amp!), "the pair shares a line").toBeLessThanOrEqual(2);
    expect(rows.aircon!, "the climate dials take the line below").toBeGreaterThan(rows.lights!);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator(".quick-access-row").screenshot({ path: path.join(SHOTS, `quick-access-${width}.png`) });
    }
  });
}
