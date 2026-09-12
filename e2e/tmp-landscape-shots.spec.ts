import { test, expect } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

async function report(page: import("@playwright/test").Page, label: string, gridSel: string) {
  const info = await page.evaluate((sel) => {
    const grid = document.querySelector(sel) as HTMLElement | null;
    const stage = grid?.closest(".control-stage") as HTMLElement | null;
    return {
      stage: stage
        ? {
            w: Math.round(stage.getBoundingClientRect().width),
            scrollW: stage.scrollWidth,
            clientW: stage.clientWidth,
            scrollH: stage.scrollHeight,
            clientH: stage.clientHeight,
            overflowsVertically: stage.scrollHeight > stage.clientHeight + 1,
            overflowsHorizontally: stage.scrollWidth > stage.clientWidth + 1,
          }
        : null,
      cols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      children: grid
        ? Array.from(grid.children).map((c) => {
            const r = c.getBoundingClientRect();
            return { cls: (c.className || "").toString().split(" ")[0], x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
          })
        : null,
    };
  }, gridSel);
  console.log(`\n===== ${label} =====\n` + JSON.stringify(info, null, 2));
  return info;
}

test("climate landscape", async ({ page }) => {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, /Climate/);
  await page.waitForTimeout(1500);
  const info = await report(page, "CLIMATE", ".climate-control-grid");
  await page.screenshot({ path: "e2e-results/tmp-climate.png" });
  expect(info.stage?.overflowsVertically, "climate column scrolls vertically").toBe(false);
  expect(info.stage?.overflowsHorizontally, "climate card overflows its stage").toBe(false);
});

test("outside landscape", async ({ page }) => {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, /Outside/);
  await page.waitForTimeout(2000);
  const info = await report(page, "OUTSIDE", ".outside-control-grid");
  await page.screenshot({ path: "e2e-results/tmp-outside.png" });
  expect(info.stage?.overflowsVertically, "outside column scrolls vertically").toBe(false);
  expect(info.stage?.overflowsHorizontally, "outside card overflows its stage").toBe(false);
});
