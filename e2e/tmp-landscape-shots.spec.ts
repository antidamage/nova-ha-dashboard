import { test, expect } from "@playwright/test";
import { gotoDashboard, selectZone, waitForStableLayout } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

async function measure(page: import("@playwright/test").Page, label: string) {
  const info = await page.evaluate(() => {
    const out: Record<string, unknown> = {};
    const stages = Array.from(document.querySelectorAll(".dashboard-home .control-stage"));
    out.stages = stages.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        group: (el as HTMLElement).dataset.group,
        w: Math.round(r.width),
        h: Math.round(r.height),
        scrollW: el.scrollWidth,
        scrollH: el.scrollHeight,
        computedWidth: getComputedStyle(el).width,
      };
    });
    const attached = Array.from(document.querySelectorAll(".horizontal-accordion-attached"));
    out.attached = attached.map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const grids = Array.from(document.querySelectorAll(".climate-control-grid, .outside-control-grid"));
    out.grids = grids.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        cls: el.className,
        w: Math.round(r.width),
        h: Math.round(r.height),
        cols: cs.gridTemplateColumns,
        display: cs.display,
      };
    });
    const knobs = Array.from(document.querySelectorAll(".temperature-encoder, .rotary-encoder"));
    out.knobs = knobs.map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    });
    return out;
  });
  console.log(`\n===== ${label} =====\n` + JSON.stringify(info, null, 2));
}

test("climate landscape", async ({ page }) => {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, /Climate/);
  await page.waitForTimeout(1200);
  await measure(page, "CLIMATE");
  await page.screenshot({ path: "e2e-results/tmp-climate.png", fullPage: false });
  expect(true).toBe(true);
});

test("outside landscape", async ({ page }) => {
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await selectZone(page, /Outside/);
  await page.waitForTimeout(1500);
  await measure(page, "OUTSIDE");
  await page.screenshot({ path: "e2e-results/tmp-outside.png", fullPage: false });
  expect(true).toBe(true);
});
