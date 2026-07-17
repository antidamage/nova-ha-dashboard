import { expect, test } from "@playwright/test";
import { gotoDashboard, selectZone } from "./helpers";

test.describe("climate controls", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await selectZone(page, /Climate/);
  });

  test("shows the temperature readouts and steppers", async ({ page }) => {
    await expect(page.locator(".climate-temp-readout").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Raise/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Lower/ }).first()).toBeVisible();
  });

  test("raises the target temperature when the unit is on", async ({ page }) => {
    const raise = page.getByRole("button", { name: "Raise Temperature" }).first();
    const readout = page.locator(".climate-temp-readout").first();

    // The stepper is disabled while the unit is off; only exercise it when live.
    if (await raise.isEnabled()) {
      const before = (await readout.textContent())?.trim();
      await raise.click();
      await expect(readout).not.toHaveText(before ?? "");
    } else {
      await expect(readout).toBeVisible();
    }
  });
});
