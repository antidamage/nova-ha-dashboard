import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone } from "./helpers";

// A floating ring layer's clip reaches past its rings so the outer labels are
// never cut off (specs/temperature-encoder.md, round 2). Its square box must not
// catch pointers: a tap at the corners belongs to whatever is underneath.

const VIEWPORTS = [
  { name: "landscape", width: 1400, height: 800 },
  { name: "portrait", width: 820, height: 1180 },
];

async function untuck(page: Page, knob: Locator) {
  await knob.scrollIntoViewIfNeeded();
  const layer = page.locator(".rotary-encoder-ring-layer");
  // A tap that lands mid-layout is ignored; the dial re-tucks after five
  // seconds, so tap again rather than waiting on one try.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const box = await knob.locator(".rotary-encoder-dial").first().boundingBox();
    if (!box) throw new Error("no knob to tap");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(500);
    if (await layer.count()) return;
  }
  await expect(layer).toHaveCount(1);
}

async function cornersHitRings(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector(".rotary-encoder-ring-layer");
    if (!layer) throw new Error("no ring layer");
    const box = layer.getBoundingClientRect();
    const inset = 3;
    const corners = [
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    return corners.map(([x, y]) => document.elementsFromPoint(x, y).some((el) => layer.contains(el)));
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`ring layer hit area (${viewport.name})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Climate panel: the layer's corners reach the page underneath", async ({ page }) => {
      await gotoDashboard(page);
      await selectZone(page, /Climate/);
      await untuck(page, page.locator(".climate-knob-body .temperature-encoder").first());
      const hits = await cornersHitRings(page);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits).not.toContain(true);
    });

    test("Quick Access: the layer's corners reach the page underneath", async ({ page }) => {
      await gotoDashboard(page);
      await untuck(page, page.locator(".rotary-encoder-floating").filter({ has: page.locator("[aria-label$='air conditioner']") }).filter({ visible: true }).first());
      const hits = await cornersHitRings(page);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits).not.toContain(true);
    });
  });
}
