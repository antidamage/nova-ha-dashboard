import { expect, test, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, "First paint" (alex, 2026-11-06): "I'm still
// seeing it load with a volume control, then a moment later the other three
// controls appear ... it needs to be able to render on the first pass."
//
// Every animation frame from navigation records how many slots the card holds, so
// the claim "never a partial set" is measured on the real page: the count goes
// from 0 straight to the full card. The live state is held back, so the pending
// frame lasts long enough to measure each slot's box, and the live frame's boxes
// must be the same ones. QUICK_ACCESS_SHOTS=<dir> saves both frames.

const SLOT_COUNT = 5;
const STATE_DELAY_MS = 8000;
const VIEWPORTS = [
  { height: 956, name: "phone portrait 440x956", width: 440 },
  { height: 393, name: "phone landscape 852x393", width: 852 },
  { height: 1080, name: "kiosk 1920x1080", width: 1920 },
];

type Rect = { h: number; w: number; x: number; y: number };

async function recordSlotCounts(page: Page) {
  await page.addInitScript(() => {
    const counts: number[] = [];
    (window as unknown as { __slotCounts: number[] }).__slotCounts = counts;
    const tick = () => {
      const count = document.querySelectorAll(".quick-access-row > *").length;
      if (counts[counts.length - 1] !== count) counts.push(count);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function isStateRequest(url: string) {
  return /\/api\/state(\.json)?(\?|$)/.test(new URL(url).pathname + new URL(url).search);
}

async function holdState(page: Page, delayMs: number) {
  await page.route((url) => isStateRequest(url.toString()), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.continue().catch(() => undefined);
  });
}

async function throttleCpu(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

/**
 * Each slot's box relative to the card's own row: the claim is about the card.
 * Where the card itself sits on the page is the rest of the dashboard's layout
 * (the zone columns fill in beside it in landscape), which this change does not
 * touch.
 */
async function slotRects(page: Page): Promise<{ dials: Rect[]; line: Rect[] }> {
  return page.locator(".quick-access-row").evaluate((row) => {
    const origin = row.getBoundingClientRect();
    const rect = (slot: Element) => {
      const box = slot.getBoundingClientRect();
      return {
        h: Math.round(box.height),
        w: Math.round(box.width),
        x: Math.round(box.x - origin.x),
        y: Math.round(box.y - origin.y),
      };
    };
    const slots = [...row.children];
    return {
      dials: slots.filter((slot) => !slot.classList.contains("panel-slot-wide")).map(rect),
      line: slots.filter((slot) => slot.classList.contains("panel-slot-wide")).map(rect),
    };
  });
}

async function slotCounts(page: Page) {
  return page.evaluate(() => (window as unknown as { __slotCounts: number[] }).__slotCounts);
}

async function shot(page: Page, name: string) {
  const dir = process.env.QUICK_ACCESS_SHOTS;
  if (dir) await page.locator(".quick-access").screenshot({ path: `${dir}/${name}.png` });
}

for (const viewport of VIEWPORTS) {
  test(`every slot is in the first frame, pending then live, at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    await recordSlotCounts(page);
    await throttleCpu(page);
    // Warm the shared config the way a returning device has it, then reload.
    await gotoDashboard(page);
    await expect(page.locator(".quick-access-row > *")).toHaveCount(SLOT_COUNT);
    await expect(page.locator(".quick-slot-pending")).toHaveCount(0);

    await holdState(page, STATE_DELAY_MS);
    await page.reload({ waitUntil: "domcontentloaded" });
    const pending = page.locator(".quick-slot-pending");
    await expect(pending).toHaveCount(3);
    await expect(page.locator(".quick-access-row > *")).toHaveCount(SLOT_COUNT);
    // Inert: nothing in it can take focus or a pointer.
    await expect(pending.first()).toHaveCSS("pointer-events", "none");
    await expect(pending.locator("[tabindex='0']")).toHaveCount(0);
    // Let the measured layout settle on the pending card before reading its boxes.
    await page.waitForTimeout(400);
    const before = await slotRects(page);
    await shot(page, `${viewport.width}x${viewport.height}-pending`);
    // Both were taken of the pending card, not of one the state reached early.
    await expect(pending, "still pending when measured and shot").toHaveCount(3, { timeout: 1 });

    await expect(pending).toHaveCount(0, { timeout: STATE_DELAY_MS + 10_000 });
    await page.waitForTimeout(400);
    const after = await slotRects(page);
    await shot(page, `${viewport.width}x${viewport.height}-live`);
    // The weather line scales its words to the card's width, so its height follows
    // the words: "Unavailable" before the reading, the condition after (8px at
    // most). In landscape the dials divide what the line leaves, so they follow it
    // by a pixel or two, as they do whenever the condition changes. Nothing moves
    // by more than that, and the arrangement is the same.
    const near = (a: Rect[], b: Rect[], px: number) =>
      a.length === b.length && a.every((rect, index) => (["h", "w", "x", "y"] as const).every((key) => Math.abs(rect[key] - b[index][key]) <= px));
    expect(near(after.dials, before.dials, 3), `dials ${JSON.stringify(before.dials)} -> ${JSON.stringify(after.dials)}`).toBe(true);
    expect(near(after.line, before.line, 8), `line ${JSON.stringify(before.line)} -> ${JSON.stringify(after.line)}`).toBe(true);

    const counts = await slotCounts(page);
    expect(counts.filter((count) => count !== 0 && count !== SLOT_COUNT), `slot counts per frame: ${counts.join(",")}`).toEqual([]);
  });
}

test("a first visit with nothing cached never paints a partial card", async ({ page }) => {
  await page.setViewportSize({ height: 956, width: 440 });
  await recordSlotCounts(page);
  await throttleCpu(page);
  await holdState(page, STATE_DELAY_MS);
  await gotoDashboard(page);
  await expect(page.locator(".quick-access-row > *")).toHaveCount(SLOT_COUNT);
  await expect(page.locator(".quick-slot-pending")).toHaveCount(0, { timeout: STATE_DELAY_MS + 10_000 });
  const counts = await slotCounts(page);
  expect(counts.filter((count) => count !== 0 && count !== SLOT_COUNT), `slot counts per frame: ${counts.join(",")}`).toEqual([]);
});

test("a state that never arrives leaves the slots pending and inert", async ({ page }) => {
  await page.setViewportSize({ height: 956, width: 440 });
  await gotoDashboard(page);
  await expect(page.locator(".quick-access-row > *")).toHaveCount(SLOT_COUNT);
  await page.route((url) => isStateRequest(url.toString()), (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".quick-slot-pending")).toHaveCount(3);
  await page.waitForTimeout(2000);
  await expect(page.locator(".quick-slot-pending")).toHaveCount(3);
  await expect(page.locator(".quick-access-row > *")).toHaveCount(SLOT_COUNT);
});
