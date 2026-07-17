import { expect, test } from "@playwright/test";
import { gotoDashboard, selectZone } from "./helpers";

// Selecting a special zone swaps the main control surface. These checks drive the
// zone router (useDashboardSelection) end to end against the demo fixtures.
test.describe("zone navigation", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("opens the world map zone", async ({ page }) => {
    await selectZone(page, /World/);
    // The attribution row renders whether or not the WebGL canvas initialises,
    // so it is the reliable signal that the map panel mounted.
    await expect(page.locator(".nova-map-attribution")).toBeVisible({ timeout: 20_000 });
  });

  test("opens the power zone", async ({ page }) => {
    await selectZone(page, /Grid/);
    await expect(page.locator(".power-mode-toggle")).toBeVisible();
    await expect(page.getByText(/kWh/).first()).toBeVisible();
  });

  test("opens the climate zone", async ({ page }) => {
    await selectZone(page, /Climate/);
    await expect(page.locator(".climate-temp-readout").first()).toBeVisible();
  });

  test("opens the network zone", async ({ page }) => {
    await selectZone(page, /Network/);
    await expect(page.getByText(/Connected|Mbps|Download|Upload/i).first()).toBeVisible();
  });

  test("returns to a lighting zone after visiting a special zone", async ({ page }) => {
    await selectZone(page, /World/);
    await expect(page.locator(".nova-map-attribution")).toBeVisible({ timeout: 20_000 });
    await selectZone(page, /Grid/);
    await expect(page.locator(".power-mode-toggle")).toBeVisible();
  });
});
