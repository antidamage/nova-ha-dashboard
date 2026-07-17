import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoDashboard, watchConsole } from "./helpers";

// The default zone in the demo fixtures has light devices, so its lighting
// controls render on load without needing to navigate first.
test.describe("lighting controls", () => {
  test("renders the spectrum, brightness, and preset controls", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.getByLabel("Zone color spectrum")).toBeVisible();

    const brightness = page.getByLabel("Brightness");
    await expect(brightness).toBeVisible();
    await expect(brightness).toHaveAttribute("aria-valuenow", /\d+/);

    await expect(page.getByRole("button", { name: /^On/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Off", exact: true })).toBeVisible();
  });

  test("toggles the zone off and back on without errors", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);

    await page.getByRole("button", { name: "Off", exact: true }).click();
    // Re-fetching the On control after the toggle keeps the locator fresh.
    await page.getByRole("button", { name: /^On/ }).first().click();

    // Controls remain interactive after a round trip through the command path.
    await expect(page.getByLabel("Brightness")).toBeVisible();
    expectNoConsoleErrors(console);
  });

  test("applies a colour preset", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);

    await page.getByRole("button", { name: "White", exact: true }).click();
    await expect(page.getByLabel("Zone color spectrum")).toBeVisible();
    expectNoConsoleErrors(console);
  });
});
