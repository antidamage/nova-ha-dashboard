import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, "Outside segment" (alex, 2026-11-02): the weather
// line is scaled UP or down to the width of the Quick Access panel, on one line,
// and its row is as tall as the scaled line. QUICK_ACCESS_SHOTS=<dir> keeps a
// screenshot at each viewport.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;

const VIEWPORTS = [
  { name: "kiosk-1080x1920", width: 1080, height: 1920 },
  { name: "iphone-pro-max", width: 440, height: 956 },
  { name: "iphone", width: 375, height: 812 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "tablet-landscape", width: 1366, height: 1024 },
];

for (const viewport of VIEWPORTS) {
  test(`weather line fills the panel on one line at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    const row = page.locator(".quick-access-row");
    await row.scrollIntoViewIfNeeded();
    const segment = page.locator(".quick-access-row .quick-segment-weather");
    await expect(segment).toBeVisible();
    // The scale is measured a frame after the first paint.
    await expect.poll(async () => (await segment.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);

    const rowBox = await row.boundingBox();
    const box = await segment.boundingBox();
    if (!rowBox || !box) throw new Error("no boxes");

    // What is DRAWN reaches (almost) both edges of the panel and never past them.
    // The extent of the segment's content, not its own box: where the line is
    // wider than the panel the box is squeezed and its content spills past it.
    const extent = await segment.evaluate((el) => {
      const rects = [...el.querySelectorAll("*")].map((child) => child.getBoundingClientRect()).filter((r) => r.width > 0);
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    });
    expect(extent.left, "left edge inside the panel").toBeGreaterThanOrEqual(rowBox.x - 1);
    expect(extent.right, "right edge inside the panel").toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
    expect(extent.right - extent.left, "fills the panel's width").toBeGreaterThanOrEqual(rowBox.width * 0.85);

    // One line: the three readings share a top, and the last of them (UV) ends
    // inside the panel rather than being cut off by it.
    const readings = await page
      .locator(".quick-access-row .quick-weather-readings > *")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), right: r.right })));
    expect(readings.length, "Temp, Feels and UV are all drawn").toBe(3);
    expect(new Set(readings.map((r) => r.top)).size, "the readings share one row").toBe(1);
    expect(Math.max(...readings.map((r) => r.right)), "UV ends inside the panel").toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);

    // Nothing is cut off or drawn over what is below: the line's scaled box is
    // inside its own slot and the card does not overflow its section.
    const slot = await page.locator(".quick-access-row .panel-slot-wide").boundingBox();
    if (!slot) throw new Error("no wide slot");
    expect(box.y).toBeGreaterThanOrEqual(slot.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(slot.y + slot.height + 1);

    if (SHOTS) {
      await page.locator(".quick-access").screenshot({ path: `${SHOTS}/weather-line-${viewport.name}.png` });
    }
  });
}
