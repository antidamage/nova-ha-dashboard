import { expect, test } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";
import {
  LIGHTING,
  POWER,
  atRest,
  geometry,
  nonControlPoint,
  openZone,
  opened,
  pull,
  toBoundary,
  touchPull,
} from "./advanced-fold.fixtures";

// The dashboard renders at a handful of frames a second in headless Chromium
// under three workers, and every mouse step waits for a frame: the default 45s
// is not enough for a test that loads, settles and drags.
test.describe.configure({ timeout: 120_000 });

test.describe("advanced fold, landscape 1366x768: touch", () => {
  test.use({ viewport: { width: 1366, height: 768 }, hasTouch: true });

  test("a 120px touch pull stays closed and springs back; a 180px pull opens", async ({ page }) => {
    await openZone(page, /Lounge/);
    const fold = page.locator(LIGHTING);
    await toBoundary(page, fold);
    const boundary = (await geometry(fold)).offset;
    const client = await page.context().newCDPSession(page);
    const divider = (await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox())!;
    const x = divider.x + divider.width / 2;
    const y = divider.y + divider.height / 2;

    await touchPull(client, x, y, 0, -120, false);
    const held = await geometry(fold);
    expect(held.open).toBe("false");
    expect(Math.abs(held.shift)).toBeGreaterThan(5);
    expect(Math.abs(held.shift)).toBeLessThanOrEqual(14);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await atRest(fold);
    const rested = await geometry(fold);
    expect(rested.open).toBe("false");
    expect(Math.abs(rested.offset - boundary)).toBeLessThanOrEqual(1);

    await touchPull(client, x, y, 0, -180);
    await opened(fold);
    const open = await geometry(fold);
    expect(Math.abs(open.offset - Math.min(boundary + 180, open.max))).toBeLessThanOrEqual(4);
  });
});

test.describe("advanced fold, portrait 820x1180: touch", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("a vertical swipe over a fold scrolls the page and does not open it", async ({ page }) => {
    await gotoDashboard(page);
    await waitForStableLayout(page);
    const fold = page.locator(".zone-panel[data-lighting-zone] .advanced-fold:not([data-foldless])").first();
    await expect(fold).toBeVisible({ timeout: 30_000 });
    await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect.poll(() => fold.evaluate((el) => el.style.touchAction)).toBe("pan-y");
    // A point in the fold that is not a control.
    const point = await nonControlPoint(fold);
    expect(point, "a non-control point in the fold").not.toBeNull();
    const before = await page.evaluate(() => window.scrollY);
    const client = await page.context().newCDPSession(page);
    await touchPull(client, point!.x, point!.y, 0, -300);
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - before), {
      message: "page scrolled",
    }).toBeGreaterThan(50);
    expect(await fold.evaluate((el) => el.dataset.open)).toBe("false");
  });
});

test.describe("advanced fold, landscape 1366x768: touch flick", () => {
  test.use({ viewport: { width: 1366, height: 768 }, hasTouch: true });

  test("a flick in Power keeps scrolling after the finger lifts, and stops at the boundary", async ({ page }) => {
    await openZone(page, /Grid/);
    const fold = page.locator(POWER);
    await fold.evaluate((el) => {
      el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
      el.scrollTop = 0;
    });
    const start = await geometry(fold);
    expect(start.max, "Power taller than its column").toBeGreaterThan(60);
    const point = await nonControlPoint(fold);
    expect(point, "a non-control point in Power").not.toBeNull();
    const { x, y } = point!;
    const client = await page.context().newCDPSession(page);
    // A short, quick swipe: 40px over four 16ms moves. The events carry their
    // own timestamps, so a slow headless frame rate does not make it a slow drag.
    const t0 = Date.now() / 1000;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }], timestamp: t0 });
    for (let i = 1; i <= 4; i += 1) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - 10 * i }],
        timestamp: t0 + 0.016 * i,
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: t0 + 0.08 });
    const lifted = (await geometry(fold)).offset;
    await expect.poll(async () => (await geometry(fold)).offset, { message: "inertia carried on" })
      .toBeGreaterThan(lifted + 10);
    // It comes to rest without breaking the band.
    let last = -1;
    await expect.poll(async () => {
      const now = (await geometry(fold)).offset;
      const same = Math.abs(now - last) < 0.5;
      last = now;
      return same;
    }, { intervals: [250] }).toBe(true);
    const rest = await geometry(fold);
    expect(rest.open).toBe("false");
    expect(rest.offset).toBeLessThanOrEqual(rest.max + 0.5);
  });
});

test.describe("advanced fold, portrait 430x932: diagonal touch", () => {
  test.use({ viewport: { width: 430, height: 932 }, hasTouch: true });

  test("a diagonal swipe decided along the fold moves only the fold", async ({ page }) => {
    await gotoDashboard(page);
    await waitForStableLayout(page);
    await selectZone(page, /Lounge/);
    const fold = page.locator(".zone-panel[data-lighting-zone] .advanced-fold:not([data-foldless])").first();
    await expect(fold).toBeVisible({ timeout: 30_000 });
    await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await waitForStableLayout(page);
    // The divider owns no control, and it cannot be mistaken for one after a late layout shift.
    const divider = (await fold.locator(':scope > .advanced-fold-track > .advanced-fold-divider').boundingBox())!;
    const point = { x: divider.x + divider.width / 2, y: divider.y + divider.height / 2 };
    const before = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    const foldBefore = await fold.evaluate((el) => el.scrollLeft);
    const client = await page.context().newCDPSession(page);
    // Mostly sideways (toward Advanced), with a vertical drift.
    await touchPull(client, point!.x, point!.y, -120, -70, false);
    const during = await fold.evaluate((el, start) => {
      const transform = getComputedStyle(el.querySelector(".advanced-fold-track")!).transform;
      const shift = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
      return Math.abs(shift) + Math.abs(el.scrollLeft - start);
    }, foldBefore);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(during, "the fold moved").toBeGreaterThan(3);
    const after = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(Math.abs(after.y - before.y), "page did not scroll vertically").toBeLessThanOrEqual(1);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  });
});
