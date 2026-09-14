import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

// Portrait dashboard (specs/portrait-layout.md, "Done means") and the portrait
// Advanced fold (specs/advanced-fold.md): two cards each holding its bar, list
// and controls; per-group selection; collapse memory; Tasks as Systems' panel;
// the sideways fold's size lock, band and page scroll; no sideways overflow.

type Rect = { left: number; top: number; width: number; height: number };

const HOME = '.horizontal-accordion[data-group="home"]';
const SYSTEMS = '.horizontal-accordion[data-group="systems"]';
const LIGHTING = `${HOME} .zone-panel[data-lighting-zone] .advanced-fold`;
const OUTSIDE_LIGHT = `${SYSTEMS} .outside-light-card.advanced-fold`;
const WEATHER = `${SYSTEMS} .weather-panel.advanced-fold`;
const CAMERA = `${SYSTEMS} .outside-camera-panel .advanced-fold`;
const POWER = `${SYSTEMS} .power-panel.advanced-fold`;

async function load(page: Page) {
  await gotoDashboard(page);
  await waitForStableLayout(page);
}

async function openSystemsZone(page: Page, zone: RegExp) {
  await selectZone(page, zone);
  await page.waitForTimeout(1200);
  // Power has no Advanced section until its first sample arrives.
  if (zone.source === "Grid") {
    await expect(page.locator(`${POWER}:not([data-foldless])`)).toHaveCount(1, { timeout: 30_000 });
    await page.waitForTimeout(300);
  }
}

async function geometry(fold: Locator) {
  return fold.evaluate((el) => {
    const pick = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
    const def = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-default") as HTMLElement;
    const divider = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-divider") as HTMLElement;
    return {
      open: el.dataset.open,
      rect: pick(el.getBoundingClientRect()),
      // Layout box, independent of the scroll offset and the band's transform.
      defaultSize: { width: def.offsetWidth, height: def.offsetHeight },
      divider: pick(divider.getBoundingClientRect()),
      offset: el.scrollLeft,
    };
  });
}

/** Elements inside Advanced ending below the fold's bottom content edge (clipping counted). */
async function belowTheFold(fold: Locator) {
  return fold.evaluate((el) => {
    const style = getComputedStyle(el);
    const bottom = el.getBoundingClientRect().bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
    const advanced = el.querySelector(":scope > .advanced-fold-track > .advanced-fold-advanced");
    if (!advanced) return ["advanced region not mounted"];
    const offenders: string[] = [];
    for (const node of advanced.querySelectorAll<HTMLElement>("*")) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let clip = Infinity;
      for (let up = node.parentElement; up && up !== advanced.parentElement; up = up.parentElement) {
        if (getComputedStyle(up).overflowY !== "visible") clip = Math.min(clip, up.getBoundingClientRect().bottom);
      }
      if (Math.min(r.bottom, clip) > bottom + 1) {
        offenders.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").slice(0, 2).join(".")} ${Math.round(r.bottom)}>${Math.round(bottom)}`);
      }
    }
    return offenders.slice(0, 5);
  });
}

/** A leftward mouse drag toward Advanced, starting on the divider (which owns no drag). */
async function pull(page: Page, fold: Locator, pixels: number) {
  await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(150);
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - pixels, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

function expectSame(actual: Rect, expected: Rect, label: string) {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key]), `${label} ${key}`).toBeLessThanOrEqual(1);
  }
}

async function noSidewaysOverflow(page: Page) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(innerWidth);
}

for (const viewport of [
  { width: 430, height: 932 },
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

          await pull(page, fold, 120);
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
      await pull(page, fold, 100);
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
