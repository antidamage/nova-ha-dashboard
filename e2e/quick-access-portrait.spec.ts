import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, portrait (Adeline, 2026-09-14): the three dials
// are one centred, wrapping row — one per line on a phone, three across when
// they fit — and no dial's rings may run off the screen edge. Below one slot's
// width every dial shrinks together, floor 100px.
// QUICK_ACCESS_SHOTS=<dir> keeps a screenshot of the card at each viewport.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;

const PHONES = [
  { name: "iphone-pro-max", width: 440, height: 956 },
  { name: "iphone", width: 375, height: 812 },
  { name: "narrow", width: 300, height: 640 },
];

function dials(page: Page) {
  return page.locator(".quick-access .quick-segment-lights .rotary-encoder-dial, .quick-access .quick-climate .rotary-encoder-dial");
}

/** One deliberate tap, the gesture that untucks a temperature knob. */
async function tap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to tap");
  await target.page().mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
  await target.page().mouse.down();
  await target.page().waitForTimeout(150);
  await target.page().mouse.up();
}

async function centres(page: Page) {
  return dials(page).evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, size: box.width };
  }));
}

/** Untuck each climate knob in turn and check its ring layer stays on screen. */
async function expectRingsOnScreen(page: Page, width: number) {
  const knobs = page.locator(".quick-access .quick-climate .rotary-encoder-dial");
  const count = await knobs.count();
  expect(count).toBe(2);
  for (let index = 0; index < count; index += 1) {
    await tap(knobs.nth(index));
    const layer = page.locator(".rotary-encoder-ring-layer");
    await expect(layer).toHaveCount(1);
    // Let the layer pin itself to the dial's rect on the next frame.
    await page.waitForTimeout(100);
    const box = await layer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    expect(box.left, `knob ${index}: rings past the left edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `knob ${index}: rings past the right edge`).toBeLessThanOrEqual(width);
    // Tap outside to tuck it again before the next knob.
    await page.mouse.click(2, 2);
    await expect(layer).toHaveCount(0);
  }
}

for (const phone of PHONES) {
  test(`portrait ${phone.name}: one centred dial per line, rings on screen`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await gotoDashboard(page);
    const row = page.locator(".quick-access-row");
    await row.scrollIntoViewIfNeeded();
    await expect(dials(page)).toHaveCount(3);

    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error("no row box");
    const rowCentre = rowBox.x + rowBox.width / 2;
    const placed = await centres(page);
    for (const [index, dial] of placed.entries()) {
      expect(Math.abs(dial.x - rowCentre), `dial ${index} centred`).toBeLessThanOrEqual(2);
      if (index > 0) expect(dial.y, `dial ${index} on its own line`).toBeGreaterThan(placed[index - 1].y);
    }
    // All three the same size, whatever it scaled to.
    expect(Math.max(...placed.map((dial) => dial.size)) - Math.min(...placed.map((dial) => dial.size))).toBeLessThanOrEqual(1);

    await expectRingsOnScreen(page, phone.width);

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator(".quick-access").screenshot({ path: path.join(SHOTS, `quick-access-portrait-${phone.name}.png`) });
    }
  });
}

test("portrait narrow phone: dials shrink to fit, not below 100px", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 640 });
  await gotoDashboard(page);
  await expect(dials(page)).toHaveCount(3);
  const sizes = await page.locator(".quick-access .rotary-encoder:not(.rotary-encoder-ring-layer)").evaluateAll((nodes) =>
    nodes.map((node) => parseFloat(getComputedStyle(node).getPropertyValue("--re-size"))));
  expect(sizes.length).toBe(3);
  for (const size of sizes) {
    expect(size).toBeLessThan(133);
    expect(size).toBeGreaterThanOrEqual(100);
  }
});

test("wide portrait: the three dials share one evenly spread line", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await gotoDashboard(page);
  await page.locator(".quick-access-row").scrollIntoViewIfNeeded();
  await expect(dials(page)).toHaveCount(3);
  const placed = await centres(page);
  for (const dial of placed) expect(Math.abs(dial.y - placed[0].y)).toBeLessThanOrEqual(2);
  const spacing = [placed[1].x - placed[0].x, placed[2].x - placed[1].x];
  expect(Math.abs(spacing[0] - spacing[1])).toBeLessThanOrEqual(2);
  for (const dial of placed) expect(dial.size).toBeCloseTo(placed[0].size, 0);

  await expectRingsOnScreen(page, 1080);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator(".quick-access").screenshot({ path: path.join(SHOTS, "quick-access-portrait-wide.png") });
  }
});
