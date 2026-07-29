import { expect, test } from "@playwright/test";
import { neutralizeTaskAlerts, seedExperienceMode, waitForStableLayout } from "./helpers";

// Click-and-drag ("hand tool") mouse scrolling. Touch is untouched; this only
// binds mouse events. A drag surface + tall spacer are injected so the test is
// deterministic regardless of the demo layout or which element sits under the
// cursor.
test.describe("click-drag scroll", () => {
  test.beforeEach(async ({ page }) => {
    await seedExperienceMode(page, "rich");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
    await neutralizeTaskAlerts(page);
    // Late-arriving content plus scroll anchoring will move scrollY under the
    // drag otherwise, which has nothing to do with what these tests measure.
    await waitForStableLayout(page);
    await page.evaluate(() => {
      // Guarantee the window overflows so there is somewhere to scroll.
      const spacer = document.createElement("div");
      spacer.style.cssText = "height:2000px;width:1px;";
      document.body.appendChild(spacer);
      // A plain, full-viewport drag surface: not in the skip list, so it pans.
      const surface = document.createElement("div");
      surface.id = "e2e-drag-surface";
      surface.style.cssText = "position:fixed;inset:0;z-index:99999;";
      document.body.appendChild(surface);
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  });

  test("a plain click (no movement past threshold) does not scroll", async ({ page }) => {
    await page.mouse.move(300, 400);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("dragging upward pans the page down", async ({ page }) => {
    await page.mouse.move(300, 500);
    await page.mouse.down();
    await page.mouse.move(300, 350, { steps: 10 });
    await page.mouse.move(300, 150, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  });

  test("dragging back down returns toward the top", async ({ page }) => {
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "auto" }));
    // Assert on the DELTA the drag produced, not an absolute offset: the
    // meaning of the test is "a downward drag pans up", and only the delta
    // says that independently of where the page happened to be sitting.
    const start = await page.evaluate(() => window.scrollY);
    await page.mouse.move(300, 150);
    await page.mouse.down();
    await page.mouse.move(300, 350, { steps: 10 });
    await page.mouse.move(300, 500, { steps: 10 });
    await page.mouse.up();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(start);
  });
});
