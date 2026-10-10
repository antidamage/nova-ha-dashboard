import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// The rotate button and the orb shadow's mirror (specs/kiosk-display-rotation.md).
const KEY = "nova.dashboard.displayRotation.v1";

const cases = [
  { name: "portrait", viewport: { width: 430, height: 932 }, side: "left" },
  { name: "landscape", viewport: { width: 1366, height: 768 }, side: "right" },
] as const;

for (const { name, viewport, side } of cases) {
  test.describe(`display rotation ${name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    test.describe.configure({ timeout: 120_000 });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; pointer-events: none !important; }";
        document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
      });
    });

    test("button sits in the bottom corner and fades with the header buttons", async ({ page }) => {
      await page.addInitScript((key) => window.localStorage.setItem(key, "true"), KEY);
      await gotoDashboard(page);

      const button = page.locator(".dashboard-rotate-link");
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 40);
      if (side === "left") expect(box.x).toBeLessThan(40);
      else expect(box.x + box.width).toBeGreaterThan(viewport.width - 40);

      const strip = page.locator(".header-fade-strip-end");
      await expect(strip).toHaveCount(1);
      const stripBox = (await strip.boundingBox())!;
      if (side === "left") expect(stripBox.y + stripBox.height).toBeCloseTo(viewport.height, 0);
      else expect(stripBox.x + stripBox.width).toBeCloseTo(viewport.width, 0);

      await page.evaluate(() => document.documentElement.style.setProperty("--nova-header-fade", "1"));
      await expect.poll(() => button.evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
      await expect.poll(() => strip.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");
    });

    test("no button until the setting is on", async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.locator(".dashboard-rotate-link")).toHaveCount(0);
    });
  });
}
