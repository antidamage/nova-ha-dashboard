import { expect, test } from "@playwright/test";
import { selectZone } from "./helpers";
import {
  CAMERA,
  LIGHTING,
  OUTSIDE_LIGHT,
  POWER,
  WEATHER,
  atRest,
  expectSameRect,
  geometry,
  openZone,
  opened,
  pull,
  settled,
  toBoundary,
  wheelOver,
  widestAdvancedOverflow,
} from "./advanced-fold.fixtures";

// The Advanced fold in landscape (specs/advanced-fold.md, "Done means"): the
// size lock, the rubber band (160px for a drag, 80px for the wheel), re-locking, independent
// sub-panel scrolling, and the page's own pan still working over the folds.

// The dashboard renders at a handful of frames a second in headless Chromium
// under three workers, and every mouse step waits for a frame: the default 45s
// is not enough for a test that loads, settles and drags.
test.describe.configure({ timeout: 120_000 });

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test.describe(`advanced fold, landscape ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const { zone, folds } of [
      { zone: /Lounge/, folds: [LIGHTING] },
      { zone: /Outside/, folds: [OUTSIDE_LIGHT, WEATHER, CAMERA] },
      { zone: /Grid/, folds: [POWER] },
    ]) {
      test(`${zone.source}: opening Advanced changes no size, and Advanced fits the sub-panel`, async ({ page }) => {
        // Three sub-panels, each measured closed and open, after a cold compile.
        test.setTimeout(120_000);
        await openZone(page, zone);
        for (const selector of folds) {
          const fold = page.locator(selector);
          await expect(fold, selector).toHaveCount(1);
          await toBoundary(page, fold);
          const closed = await geometry(fold);
          expect(closed.open, selector).toBe("false");

          // Closed, the divider is inside the sub-panel on both axes.
          expect(closed.divider.left, `${selector} divider left`).toBeGreaterThanOrEqual(closed.rect.left - 0.5);
          expect(closed.divider.left + closed.divider.width).toBeLessThanOrEqual(closed.rect.left + closed.rect.width + 0.5);
          expect(closed.divider.top, `${selector} divider top`).toBeGreaterThanOrEqual(closed.rect.top - 0.5);
          expect(closed.divider.top + closed.divider.height, `${selector} divider bottom`)
            .toBeLessThanOrEqual(closed.rect.top + closed.rect.height + 0.5);

          await pull(page, fold, 200);
          await opened(fold);
          const open = await geometry(fold);
          expectSameRect(open.rect, closed.rect, `${selector} sub-panel`);
          expectSameRect(
            { left: 0, top: 0, ...open.defaultSize },
            { left: 0, top: 0, ...closed.defaultSize },
            `${selector} default area`,
          );
          expect(await widestAdvancedOverflow(fold), `${selector} Advanced wider than the sub-panel`).toEqual([]);
        }
      });
    }

    test("a 120px pull resists and springs back; a 180px pull opens on the 1:1 offset", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;

      await pull(page, fold, 120, false);
      const held = await geometry(fold);
      expect(held.open).toBe("false");
      expect(Math.abs(held.shift)).toBeGreaterThan(5);
      expect(Math.abs(held.shift)).toBeLessThanOrEqual(14);
      await page.mouse.up();
      await atRest(fold);
      const rested = await geometry(fold);
      expect(rested.open).toBe("false");
      expect(Math.abs(rested.shift)).toBeLessThan(0.5);
      expect(Math.abs(rested.offset - boundary)).toBeLessThanOrEqual(1);

      await pull(page, fold, 180);
      await opened(fold);
      const open = await geometry(fold);
      expect(Math.abs(open.offset - Math.min(boundary + 180, open.max))).toBeLessThanOrEqual(4);
    });

    test("wheel: three 100px notches stay closed, four open", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;

      await wheelOver(page, fold, 3);
      expect((await geometry(fold)).open).toBe("false");
      // The pull decays after 400ms of stillness and the band springs back.
      await atRest(fold);
      expect((await geometry(fold)).open).toBe("false");

      await wheelOver(page, fold, 4);
      await opened(fold);
      const open = await geometry(fold);
      expect(Math.abs(open.offset - Math.min(boundary + 100, open.max))).toBeLessThanOrEqual(4);
    });

    test("scrolling back to the boundary closes Advanced, and the next pull resists", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const closed = await geometry(fold);

      await pull(page, fold, 180);
      await opened(fold);

      // Back by mouse drag, which the fold drives: well past the boundary.
      const box = (await fold.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 20 + 260, { steps: 12 });
      await page.mouse.up();
      await expect.poll(async () => (await geometry(fold)).open).toBe("false");
      const back = await geometry(fold);
      expectSameRect({ left: 0, top: 0, ...back.defaultSize }, { left: 0, top: 0, ...closed.defaultSize }, "default area");

      await toBoundary(page, fold);
      await pull(page, fold, 80, false);
      const again = await geometry(fold);
      expect(again.open).toBe("false");
      expect(Math.abs(again.shift)).toBeGreaterThan(5);
      await page.mouse.up();
    });

    test("Power's default view scrolls freely and the band engages only at its end", async ({ page }) => {
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await fold.evaluate((el) => el.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }));
      const start = await geometry(fold);
      if (viewport.height <= 768) expect(start.max, "Power taller than its column").toBeGreaterThan(0);
      test.skip(start.max <= 0, "Power's default view fits this column");

      // Wheel down from the top: native scrolling through the default view.
      await wheelOver(page, fold, Math.ceil(start.max / 100) + 1);
      await expect.poll(async () => Math.abs((await geometry(fold)).offset - start.max)).toBeLessThanOrEqual(1);
      await atRest(fold);
      expect((await geometry(fold)).open).toBe("false");

      await pull(page, fold, 180);
      await opened(fold);

      await fold.evaluate((el, boundary) => {
        el.scrollTop = boundary;
      }, start.max);
      await expect.poll(async () => (await geometry(fold)).open).toBe("false");
    });

    test("scrolling one of Outside's sub-panels by wheel and drag leaves the others where they were", async ({ page }) => {
      await openZone(page, /Outside/);
      const weather = page.locator(WEATHER);
      const others = [page.locator(OUTSIDE_LIGHT), page.locator(CAMERA)];
      await toBoundary(page, weather);
      await pull(page, weather, 180);
      await opened(weather);
      const before = await Promise.all(others.map((fold) => geometry(fold)));
      const start = (await geometry(weather)).offset;
      expect(start, "weather opened past its boundary").toBeGreaterThan(20);

      // A real wheel over the open weather panel scrolls it natively, back up.
      const box = (await weather.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -20);
      await expect.poll(async () => (await geometry(weather)).offset).toBeLessThan(start - 10);
      let after = await Promise.all(others.map((fold) => geometry(fold)));
      after.forEach((g, index) => expect(g.offset, `sub-panel ${index} after wheel`).toBe(before[index].offset));

      // A real mouse drag over it, which the fold drives, forward again.
      const wheeled = (await geometry(weather)).offset;
      const x = box.x + box.width / 2;
      await page.mouse.move(x, box.y + box.height - 40);
      await page.mouse.down();
      await page.mouse.move(x, box.y + box.height - 40 - 30, { steps: 6 });
      await page.mouse.up();
      await expect.poll(async () => (await geometry(weather)).offset).toBeGreaterThan(wheeled + 10);
      after = await Promise.all(others.map((fold) => geometry(fold)));
      after.forEach((g, index) => expect(g.offset, `sub-panel ${index} after drag`).toBe(before[index].offset));
    });

    test("a drag starting on a knob does not pull", async ({ page }) => {
      await openZone(page, /Outside/);
      const fold = page.locator(OUTSIDE_LIGHT);
      await toBoundary(page, fold);
      const knob = fold.locator('[role="slider"]').first();
      const box = (await knob.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 120, { steps: 12 });
      const during = await geometry(fold);
      await page.mouse.up();
      expect(during.open).toBe("false");
      expect(Math.abs(during.shift)).toBeLessThan(0.5);
      expect((await geometry(fold)).open).toBe("false");

      // A knob's toggle ring (role="switch") owns its drag too. The demo's
      // Outside light has none, so one is placed in the default view.
      await fold.evaluate((el) => {
        const ring = document.createElement("div");
        ring.setAttribute("role", "switch");
        ring.setAttribute("aria-checked", "false");
        ring.setAttribute("aria-label", "Test ring");
        ring.style.cssText = "width:80px;height:80px;flex:none";
        el.querySelector(".advanced-fold-default")!.appendChild(ring);
      });
      await toBoundary(page, fold);
      const ring = (await fold.getByRole("switch", { name: "Test ring" }).boundingBox())!;
      await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2);
      await page.mouse.down();
      await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2 - 120, { steps: 12 });
      const ringDuring = await geometry(fold);
      await page.mouse.up();
      expect(ringDuring.open).toBe("false");
      expect(Math.abs(ringDuring.shift)).toBeLessThan(0.5);
    });

    test("the page's drag-pan and wheel-pan still move the page over a fold", async ({ page }) => {
      await openZone(page, /Outside/);
      const fold = page.locator(WEATHER);
      await toBoundary(page, fold);
      const box = (await fold.boundingBox())!;

      const startX = await page.evaluate(() => window.scrollX);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      const dragged = await page.evaluate(() => window.scrollX);
      expect(Math.abs(dragged - startX), "drag pans the page").toBeGreaterThan(50);

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(200, 0);
      await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollX)) - dragged), {
        message: "sideways wheel pans the page",
      }).toBeGreaterThan(50);
      expect((await geometry(fold)).open).toBe("false");
    });

    test("with reduced motion the break lands on the 1:1 position without animating", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openZone(page, /Grid/);
      const fold = page.locator(POWER);
      await toBoundary(page, fold);
      const boundary = (await geometry(fold)).offset;
      await pull(page, fold, 180);
      await expect.poll(async () => (await geometry(fold)).open).toBe("true");
      const opened = await geometry(fold);
      expect(Math.abs(opened.shift)).toBeLessThan(0.5);
      expect(Math.abs(opened.offset - Math.min(boundary + 180, opened.max))).toBeLessThanOrEqual(4);
    });

    test("choosing another zone and coming back shows the fold closed; so does a reload", async ({ page }) => {
      await openZone(page, /Lounge/);
      const fold = page.locator(LIGHTING);
      await toBoundary(page, fold);
      await pull(page, fold, 200);
      await opened(fold);

      // Mark this zone's fold, so each switch can wait for a new one to mount.
      const mark = (value: string) => page.locator(LIGHTING).evaluate((el, v) => {
        el.dataset.testMark = v;
      }, value);
      await mark("lounge");
      await selectZone(page, /Kitchen/);
      await expect(page.locator(`${LIGHTING}[data-test-mark]`)).toHaveCount(0);
      await expect(page.locator(LIGHTING)).toHaveCount(1);
      await mark("kitchen");
      await selectZone(page, /Lounge/);
      await expect(page.locator(`${LIGHTING}[data-test-mark]`)).toHaveCount(0);
      await expect(page.locator(LIGHTING)).toHaveCount(1);
      expect((await geometry(page.locator(LIGHTING))).open).toBe("false");

      await settled(page.locator(LIGHTING));
      await toBoundary(page, page.locator(LIGHTING));
      await pull(page, page.locator(LIGHTING), 200);
      await opened(page.locator(LIGHTING));
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(LIGHTING)).toHaveCount(1, { timeout: 30_000 });
      expect((await geometry(page.locator(LIGHTING))).open).toBe("false");
    });
  });
}
