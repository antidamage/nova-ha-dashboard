import { expect, test } from "@playwright/test";
import { selectZone } from "./helpers";
import { HOME, SYSTEMS, load, noSidewaysOverflow } from "./portrait-layout.fixtures";

// Portrait dashboard (specs/portrait-layout.md, "Done means"): two cards each
// holding its bar, list and controls; per-group selection; collapse memory;
// Tasks as Systems' panel; no sideways overflow. The portrait Advanced fold is
// in portrait-layout.fold.spec.ts.

for (const viewport of [
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
]) {
  test.describe(`portrait ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("page order is Home bar, list, controls, then Systems bar, list, controls", async ({ page }) => {
      await load(page);
      await selectZone(page, /Outside/);
      await page.waitForTimeout(800);
      const parts = [
        `${HOME} > .horizontal-accordion-trigger`,
        `${HOME} > .horizontal-accordion-content`,
        `${HOME} > .horizontal-accordion-attached`,
        `${SYSTEMS} > .horizontal-accordion-trigger`,
        `${SYSTEMS} > .horizontal-accordion-content`,
        `${SYSTEMS} > .horizontal-accordion-attached`,
      ];
      const layout = await page.evaluate((selectors) => selectors.map((selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      }), parts);
      layout.forEach((box, index) => {
        expect(box, parts[index]).not.toBeNull();
        expect(box!.height, parts[index]).toBeGreaterThan(0);
      });
      const inDomOrder = await page.evaluate((selectors) => {
        const found = selectors.map((selector) => document.querySelector(selector)!);
        return found.slice(1).every((node, index) => Boolean(found[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      }, parts);
      expect(inDomOrder, "DOM order").toBe(true);
      for (let index = 1; index < layout.length; index += 1) {
        expect(layout[index]!.top, `${parts[index]} below ${parts[index - 1]}`).toBeGreaterThanOrEqual(layout[index - 1]!.bottom - 1);
      }
      const bar = await page.locator(`${HOME} > .horizontal-accordion-trigger`).boundingBox();
      expect(Math.abs(bar!.height - 56), "bar height").toBeLessThanOrEqual(2);
      await noSidewaysOverflow(page);
    });

    test("each card keeps its own selection", async ({ page }) => {
      await load(page);
      await selectZone(page, /Bedroom/);
      await page.waitForTimeout(600);
      await selectZone(page, /Outside/);
      await page.waitForTimeout(600);
      await expect(page.locator(`${HOME} .horizontal-accordion-attached .zone-panel-title`)).toHaveText(/Bedroom/i);
      await expect(page.locator(`${SYSTEMS} .horizontal-accordion-attached .outside-control-grid`)).toBeVisible();
      await selectZone(page, /Kitchen/);
      await page.waitForTimeout(600);
      await expect(page.locator(`${HOME} .horizontal-accordion-attached .zone-panel-title`)).toHaveText(/Kitchen/i);
      await expect(page.locator(`${SYSTEMS} .horizontal-accordion-attached .outside-control-grid`)).toBeVisible();
    });

    test("collapsing a card hides its list and controls, and survives a reload", async ({ page }) => {
      await load(page);
      const trigger = page.locator(`${HOME} > .horizontal-accordion-trigger`);
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(`${HOME} > .horizontal-accordion-content`)).toBeHidden();
      await expect(page.locator(`${HOME} > .horizontal-accordion-attached`)).toHaveCount(0);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".zones-panel")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await expect(page.locator(`${HOME} > .horizontal-accordion-trigger`)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(`${HOME} > .horizontal-accordion-attached`)).toHaveCount(0);
      await expect(page.locator(`${SYSTEMS} > .horizontal-accordion-attached`)).toBeVisible();
    });

    test("Tasks shows inside the Systems card and stays mounted when hidden", async ({ page }) => {
      await load(page);
      const stage = page.locator(".tasks-stage");
      await stage.evaluate((el) => { (el as HTMLElement & { novaMark?: number }).novaMark = 1; });
      await selectZone(page, /Reminders/);
      await expect(stage.locator(".tasks-panel")).toBeVisible();
      // Joined under the Systems card: no gap, same width.
      const card = (await page.locator(SYSTEMS).boundingBox())!;
      const box = (await stage.boundingBox())!;
      expect(Math.abs(box.y - (card.y + card.height)), "gap under Systems").toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - card.width), "width").toBeLessThanOrEqual(1);

      await selectZone(page, /Network/);
      await expect(stage).toBeHidden();
      await selectZone(page, /Reminders/);
      await expect(stage.locator(".tasks-panel")).toBeVisible();
      await page.locator(`${SYSTEMS} > .horizontal-accordion-trigger`).click();
      await expect(stage).toBeHidden();
      await page.locator(`${SYSTEMS} > .horizontal-accordion-trigger`).click();
      await expect(stage.locator(".tasks-panel")).toBeVisible();
      expect(await page.locator(".tasks-stage").count()).toBe(1);
      expect(await stage.evaluate((el) => (el as HTMLElement & { novaMark?: number }).novaMark), "tasks stage remounted").toBe(1);
    });
  });
}
