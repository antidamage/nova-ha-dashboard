import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoDashboard, watchConsole } from "./helpers";

test.describe("dashboard shell", () => {
  test("loads the demo dashboard without console errors", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);

    await expect(page).toHaveTitle(/Control/);
    await expect(page.getByLabel(/avatar$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "[◯_◯]" })).toBeVisible();

    expectNoConsoleErrors(console);
  });

  test("renders the core panels", async ({ page }) => {
    await gotoDashboard(page);

    // Zones panel and its zone buttons.
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Home/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Everything/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /World/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reminders/ })).toBeVisible();

    // Live clock keeps ticking.
    const clock = page.locator(".clock-time");
    await expect(clock).toBeVisible();
    await expect(clock).not.toHaveText("");

    // Configuration entry point.
    await expect(page.getByRole("link", { name: /Config/ })).toHaveAttribute("href", "/config/");
  });

  test("exposes the configuration link to /config", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("link", { name: /Config/ }).click();
    await expect(page).toHaveURL(/\/config\/?$/);
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
  });
});
