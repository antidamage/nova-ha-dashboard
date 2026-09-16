import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoDashboard, neutralizeTaskAlerts, selectZone } from "./helpers";

/**
 * The reminder lists live past the panel's Advanced line now
 * (specs/tasks-panel.md, Round 2), so a test that wants a row opens the fold
 * with the same drag a finger would.
 */
async function openReminderLists(page: Page): Promise<Locator> {
  const fold = page.locator(".tasks-panel .advanced-fold:not([data-foldless])");
  await expect(fold).toBeVisible({ timeout: 30_000 });
  const axis = await fold.getAttribute("data-axis");
  await fold.evaluate((el, vertical) => {
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (vertical) el.scrollTop = el.scrollHeight;
    else el.scrollLeft = el.scrollWidth;
  }, axis === "y");
  await expect.poll(() => fold.evaluate((el) => el.style.touchAction !== "")).toBe(true);
  const divider = await fold.locator(":scope > .advanced-fold-track > .advanced-fold-divider").boundingBox();
  if (!divider) throw new Error("divider not rendered");
  const x = divider.x + divider.width / 2;
  const y = divider.y + divider.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(axis === "y" ? x : x - 200, axis === "y" ? y - 200 : y, { steps: 14 });
  await page.mouse.up();
  await expect(fold).toHaveAttribute("data-open", "true");
  return fold.locator(".advanced-fold-advanced");
}

test.describe("tasks and reminders", () => {
  test.beforeEach(async ({ page }) => {
    // Keep the alert overlay live: one test dismisses it explicitly. The others
    // neutralize it so it cannot intercept clicks.
    // Banners default off now (per-device opt-in), so ask for them: one test
    // dismisses the overlay explicitly and the others neutralize it.
    await gotoDashboard(page, { neutralizeAlerts: false, reminderBanners: true });
  });

  test("shows the reminders panel when its zone is selected", async ({ page }) => {
    await neutralizeTaskAlerts(page);
    await selectZone(page, /Reminders/);
    await expect(page.getByRole("heading", { name: "Reminders" })).toBeVisible();
    const advanced = await openReminderLists(page);
    await expect(advanced.locator(".task-row-main").first()).toBeVisible();
  });

  test("dismisses the task alert notification", async ({ page }) => {
    // The current alert's title should clear after dismissing, even if another
    // queued alert takes its place afterwards.
    const banner = page.locator(".task-alert-title").first();
    await expect(banner).toBeVisible();
    const title = (await banner.textContent())?.trim() ?? "";
    await page.getByRole("button", { name: `Dismiss ${title} notification` }).click();
    await expect(page.getByRole("button", { name: `Dismiss ${title} notification` })).toHaveCount(0);
  });

  test("expands a local task into its editor", async ({ page }) => {
    await neutralizeTaskAlerts(page);
    await selectZone(page, /Reminders/);
    // A local task opens its editor in place of the lists; Back returns to them.
    const advanced = await openReminderLists(page);
    await advanced.locator(".task-row-main", { hasText: "Water the balcony plants" }).click();
    await expect(advanced.locator(".task-inline-editor")).toBeVisible();
    await expect(advanced.locator("[data-task-list]")).toHaveCount(0);
    await advanced.getByRole("button", { name: "Back" }).click();
    await expect(advanced.locator(".task-inline-editor")).toHaveCount(0);
    await expect(advanced.locator('[data-task-list="today"]')).toHaveCount(1);
  });
});
