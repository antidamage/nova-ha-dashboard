import { expect, test } from "@playwright/test";
import {
  CAMERA,
  LIGHTING,
  OUTSIDE_LIGHT,
  POWER,
  WEATHER,
  belowTheFold,
  expectSame,
  geometry,
  load,
  noSidewaysOverflow,
  openSystemsZone,
  pull,
} from "./portrait-layout.fixtures";

// The portrait Advanced fold (specs/advanced-fold.md): the sideways fold's size
// lock, band and page scroll, with no sideways overflow. The portrait card
// layout is in portrait-layout.spec.ts.

for (const viewport of [
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
]) {
  test.describe(`portrait ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const { zone, folds } of [
      { zone: null, folds: [LIGHTING] },
      { zone: /Outside/, folds: [OUTSIDE_LIGHT, WEATHER, CAMERA] },
      { zone: /Grid/, folds: [POWER] },
    ]) {
      test(`${zone?.source ?? "Home lighting"}: opening Advanced changes no size, and nothing hangs below`, async ({ page }) => {
        test.setTimeout(120_000);
        await load(page);
        if (zone) await openSystemsZone(page, zone);
        for (const selector of folds) {
          const fold = page.locator(selector);
          await expect(fold, selector).toHaveCount(1);
          await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
          await page.waitForTimeout(200);
          const closed = await geometry(fold);
          expect(closed.open, selector).toBe("false");
          expect(closed.divider.left, `${selector} divider inside`).toBeGreaterThanOrEqual(closed.rect.left - 0.5);
          expect(closed.divider.left + closed.divider.width, `${selector} divider inside right edge`)
            .toBeLessThanOrEqual(closed.rect.left + closed.rect.width + 0.5);

          await pull(page, fold, 200);
          await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
          await page.waitForTimeout(200);
          const opened = await geometry(fold);
          expect(opened.open, `${selector} opened`).toBe("true");
          expectSame(opened.rect, closed.rect, `${selector} sub-panel`);
          expectSame(
            { left: 0, top: 0, ...opened.defaultSize },
            { left: 0, top: 0, ...closed.defaultSize },
            `${selector} default area`,
          );
          expect(await belowTheFold(fold), `${selector} Advanced taller than the default view`).toEqual([]);
          await noSidewaysOverflow(page);
        }
      });
    }

    test("a 60px leftward drag stays closed; 100px opens", async ({ page }) => {
      await load(page);
      await openSystemsZone(page, /Outside/);
      const fold = page.locator(WEATHER);
      await pull(page, fold, 60);
      const held = await geometry(fold);
      expect(held.open).toBe("false");
      expect(held.offset).toBeLessThanOrEqual(1);
      await pull(page, fold, 180);
      expect((await geometry(fold)).open).toBe("true");
    });

    test("a vertical wheel over a fold scrolls the page and does not open it", async ({ page }) => {
      await load(page);
      const fold = page.locator(LIGHTING);
      await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(200);
      const box = (await fold.boundingBox())!;
      const before = await page.evaluate(() => window.scrollY);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < 4; i += 1) {
        await page.mouse.wheel(0, 100);
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(400);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - before), "page scrolled").toBeGreaterThan(50);
      expect((await geometry(fold)).open).toBe("false");
      await noSidewaysOverflow(page);
    });
  });
}
