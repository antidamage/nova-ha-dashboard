import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

const DIR = "C:/Users/Addie/AppData/Local/Temp/claude/D--Projects-Agent/d06ad3c0-bb72-49ae-9fe9-8f78a8300965/scratchpad/shots-layout3/";
const HOME = '.horizontal-accordion[data-group="home"]';
const SYSTEMS = '.horizontal-accordion[data-group="systems"]';
const LIGHTING = `${HOME} .zone-panel[data-lighting-zone] .advanced-fold`;
const OUTSIDE_LIGHT = `${SYSTEMS} .outside-light-card.advanced-fold`;

async function pull(page: Page, fold: Locator, pixels: number) {
  await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(150);
  const d = (await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox())!;
  const x = d.x + d.width / 2, y = d.y + d.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - pixels, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

for (const vp of [{ width: 768, height: 1024 }, { width: 820, height: 1180 }]) {
  test.describe(`shots ${vp.width}`, () => {
    test.use({ viewport: vp });
    test("portrait lighting + outside + transcript", async ({ page }) => {
      test.setTimeout(120_000);
      await gotoDashboard(page);
      await waitForStableLayout(page);
      const fold = page.locator(LIGHTING);
      await fold.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}portrait-${vp.width}-lighting-closed.png` });
      await pull(page, fold, 200);
      await page.screenshot({ path: `${DIR}portrait-${vp.width}-lighting-open.png` });
      await selectZone(page, /Outside/);
      await page.waitForTimeout(1200);
      const ol = page.locator(OUTSIDE_LIGHT);
      await ol.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}portrait-${vp.width}-outside-closed.png` });
      await pull(page, ol, 200);
      await page.screenshot({ path: `${DIR}portrait-${vp.width}-outside-open.png` });
      const log = page.locator(".voice-transcript-log");
      await log.first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${DIR}portrait-${vp.width}-transcript.png` });
    });
  });
}

test.describe("shots landscape", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("landscape transcript", async ({ page }) => {
    test.setTimeout(120_000);
    await gotoDashboard(page);
    await waitForStableLayout(page);
    const panel = page.locator(".voice-transcript-panel");
    await expect(panel).toHaveCount(1);
    const trigger = panel.locator(".horizontal-accordion-trigger");
    if (await trigger.count()) {
      if ((await trigger.first().getAttribute("aria-expanded")) === "false") await trigger.first().click();
      await page.waitForTimeout(500);
    }
    await panel.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${DIR}landscape-transcript.png` });
  });
});
