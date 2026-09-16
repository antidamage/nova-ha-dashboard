import { expect, test, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

// Per-device theme override button (specs/theme-override.md).
const SHOTS = "C:/Users/Addie/AppData/Local/Temp/claude/D--Projects-Agent/d06ad3c0-bb72-49ae-9fe9-8f78a8300965/scratchpad/shots-theme";
const KEY = "nova.dashboard.themeOverride.v1";
const GLOBAL_KEYS = ["nova.dashboard.accent.v1", "nova.dashboard.sharedAccent.v1"];

// Clicks can land before hydration attaches handlers; retry until the label moves.
async function clickTo(page: Page, label: string) {
  const button = page.locator(".dashboard-theme-override-link");
  await expect(async () => {
    if ((await button.getAttribute("aria-label")) !== label) await button.click();
    await expect(button).toHaveAttribute("aria-label", label, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

const variant = (page: Page) => page.evaluate(() => document.documentElement.dataset.themeVariant ?? "");
const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--cyber-bg").trim());
const globals = (page: Page) =>
  page.evaluate((keys) => keys.map((key) => window.localStorage.getItem(key)), GLOBAL_KEYS);

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1366, height: 768 }]) {
  test.describe(`theme override ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    // Several reloads and a shared dev server under load from parallel suites.
    test.describe.configure({ timeout: 120_000 });

    // The Next dev-mode indicator sits bottom-left over the landscape sidebar
    // buttons; it does not exist in production.
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        const style = document.createElement("style");
        style.textContent = "nextjs-portal { display: none !important; pointer-events: none !important; }";
        document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
      });
    });

    test("cycles, persists, and leaves the global theme alone", async ({ page }) => {
      await gotoDashboard(page);
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
      await page.reload();
      await gotoDashboard(page);

      const button = page.locator(".dashboard-theme-override-link");
      await expect(button).toHaveAttribute("aria-label", "Theme: follows config");
      await expect.poll(() => variant(page)).not.toBe("");
      const baseline = await variant(page);
      const globalBefore = await globals(page);

      await clickTo(page, "Theme: auto");
      await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), KEY)).toBe("auto");

      await clickTo(page, "Theme: light");
      await expect.poll(() => variant(page)).toBe("light");
      const lightBg = await background(page);
      await page.screenshot({ path: `${SHOTS}/${viewport.width}-light.png` });

      await clickTo(page, "Theme: dark");
      await expect.poll(() => variant(page)).toBe("dark");
      expect(await background(page)).not.toBe(lightBg);
      await page.screenshot({ path: `${SHOTS}/${viewport.width}-dark.png` });

      // Persists across reload.
      await page.reload();
      await gotoDashboard(page);
      await expect(button).toHaveAttribute("aria-label", "Theme: dark");
      await expect.poll(() => variant(page)).toBe("dark");

      // Back to unset: key removed, the global selection applies again.
      await clickTo(page, "Theme: follows config");
      expect(await page.evaluate((key) => window.localStorage.getItem(key), KEY)).toBeNull();
      await expect.poll(() => variant(page)).toBe(baseline);
      expect(await globals(page)).toEqual(globalBefore);
    });

    test("unset follows a global selection change", async ({ page }) => {
      await gotoDashboard(page);
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
      const baseline = await variant(page);
      const flipped = baseline === "dark" ? "light" : "dark";
      // Simulate the config page changing the global selection in this tab.
      await expect(async () => {
        await page.evaluate((selection) => {
          window.dispatchEvent(new CustomEvent("nova-theme-set-change", {
            detail: { originId: -1, themeSet: { selection } },
          }));
        }, flipped);
        expect(await variant(page)).toBe(flipped);
      }).toPass({ timeout: 15_000 });
    });

    test("header buttons: cog icon-only, Reload left of theme left of cog", async ({ page }) => {
      await gotoDashboard(page);
      const reload = page.getByRole("button", { name: "Reload page" });
      const theme = page.locator(".dashboard-theme-override-link");
      const cog = page.getByRole("link", { name: "Configuration" });
      await expect(cog).toBeVisible();
      expect((await cog.innerText()).trim()).toBe("");
      const [r, t, c] = await Promise.all([reload.boundingBox(), theme.boundingBox(), cog.boundingBox()]);
      expect(r && t && c).toBeTruthy();
      if (viewport.width < 420) {
        // Narrow portrait: theme sits under Reload to clear the orb.
        expect(r!.y + r!.height).toBeLessThanOrEqual(t!.y);
        expect(Math.abs(r!.x - t!.x)).toBeLessThan(1);
      } else {
        expect(r!.x + r!.width).toBeLessThanOrEqual(t!.x);
      }
      expect(t!.x + t!.width).toBeLessThanOrEqual(c!.x);
      await page.screenshot({ path: `${SHOTS}/${viewport.width}-buttons.png` });
    });

    test("no header button intersects the orb's resting box", async ({ page }) => {
      await gotoDashboard(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const orb = await page.locator(".nova-avatar-host").first().boundingBox();
      expect(orb).toBeTruthy();
      for (const selector of [".dashboard-reload-link", ".dashboard-theme-override-link", ".dashboard-config-link:not(.dashboard-reload-link):not(.dashboard-theme-override-link)"]) {
        const box = (await page.locator(selector).boundingBox())!;
        const overlaps = box.x < orb!.x + orb!.width && orb!.x < box.x + box.width
          && box.y < orb!.y + orb!.height && orb!.y < box.y + box.height;
        expect(overlaps, `${selector} overlaps orb`).toBe(false);
      }
    });

    test("auto follows the sun", async ({ page }) => {
      await gotoDashboard(page);
      const button = page.locator(".dashboard-theme-override-link");
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
      await clickTo(page, "Theme: auto");
      for (const [state, expected] of [["below_horizon", "dark"], ["above_horizon", "light"]] as const) {
        await expect(async () => {
          await page.evaluate((sunState) => {
            window.dispatchEvent(new CustomEvent("nova-sun-change", { detail: { state: sunState } }));
          }, state);
          expect(await variant(page)).toBe(expected);
        }).toPass({ timeout: 15_000 });
      }
      await page.evaluate((key) => window.localStorage.removeItem(key), KEY);
    });

    test("header buttons fade and stop taking input once scrolled", async ({ page }) => {
      test.skip(viewport.width < viewport.height, "landscape sidebar fade");
      await gotoDashboard(page);
      await expect(async () => {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(600, 0);
        await page.evaluate(() => window.scrollTo(600, 0));
        await page.evaluate(() => window.dispatchEvent(new Event("scroll")));
        expect(await page.evaluate(() => document.documentElement.classList.contains("nova-header-controls-disabled"))).toBe(true);
      }).toPass({ timeout: 15_000 });
      for (const selector of [".dashboard-reload-link", ".dashboard-theme-override-link"]) {
        const [opacity, events] = await page.locator(selector).evaluate((el) => [Number(getComputedStyle(el).opacity), getComputedStyle(el).pointerEvents]);
        expect(opacity).toBeLessThan(0.5);
        expect(events).toBe("none");
      }
    });
  });
}
