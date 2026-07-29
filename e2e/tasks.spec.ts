import { expect, test } from "@playwright/test";
import { gotoDashboard, neutralizeTaskAlerts, selectZone } from "./helpers";

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
    await expect(page.locator(".task-row-main").first()).toBeVisible();
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
    // The local demo task expands into an inline editor; clicking again collapses.
    const row = page.locator(".task-row-main", { hasText: "Water the balcony plants" });
    await row.click();
    await expect(page.locator(".task-inline-editor")).toBeVisible();
    await row.click();
    await expect(page.locator(".task-inline-editor")).toHaveCount(0);
  });
});
