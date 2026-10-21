import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoConfig, watchConsole } from "./helpers";
import { paintOrderAt, viewportY } from "./config.fixtures";

// The configuration workspace: its sections, the fixed header icons over the
// scroll shadow, import/export, Back, and the voice controls. The breadcrumb
// trail's rest-and-pin behaviour is in config.trail.spec.ts.

test.describe("configuration workspace", () => {
  test("renders the workspace sections without errors", async ({ page }) => {
    const console = watchConsole(page);
    await gotoConfig(page);

    await expect(page.getByRole("button", { name: "Back to dashboard" }).first()).toBeVisible();
    for (const category of ["Assistant", "Voice & People", "Appearance & Dashboard", "Devices", "System & Data"]) {
      await expect(page.getByRole("button", { name: new RegExp(category.replace("&", "\\&")) })).toBeVisible();
    }

    await page.getByRole("button", { name: /System & Data/ }).click();
    for (const section of ["Config Import/Export", "Secrets", "Updates", "System Power"]) {
      await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: /Devices/ }).click();
    await expect(page.getByRole("button", { name: "Camera", exact: true })).toBeVisible();
    expectNoConsoleErrors(console);
  });

  test("keeps the header icons fixed, over the scroll shadow", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /System & Data/ }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    // Two copies exist (resting and pinned); both read the same chain, and the
    // resting one is the visible one at the top of the page.
    await expect(page.locator(".config-breadcrumb-slot .config-breadcrumb")).toContainText("Updates");

    const icons = page.locator(".dashboard-reload-link, .dashboard-back-link, .dashboard-logout-link");
    await expect(icons).toHaveCount(3);
    const strip = page.locator(".header-fade-strip");

    // How tall a category happens to be is not a test input: give the page
    // something to scroll whatever the panels measure.
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    // The page is anchored at the top for the rest measurement. Polling the
    // opacity with the scroll re-applied inside it, rather than sleeping once and
    // trusting it: opening the section schedules its own smooth scroll into view
    // two frames later, and that can still move the page after our first
    // scrollTo, which reads as a lit strip at the top of the page.
    const stripOpacity = () => strip.evaluate((element) => Number(getComputedStyle(element).opacity));
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        return stripOpacity();
      })
      .toBeLessThan(0.1);
    const restingIcons = await viewportY(icons);

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(strip).toHaveCSS("opacity", "1");
    expect(await viewportY(icons), "the icons do not move with the page").toEqual(restingIcons);

    // In front of the shadow: the icons, and the trail once it has pinned.
    expect(
      await paintOrderAt(page, [
        ".dashboard-reload-link",
        ".dashboard-back-link",
        ".dashboard-logout-link",
        ".config-header-band .config-breadcrumb",
      ]),
    ).toEqual({
      ".dashboard-reload-link": true,
      ".dashboard-back-link": true,
      ".dashboard-logout-link": true,
      ".config-header-band .config-breadcrumb": true,
    });

    // ...and the reverse, so the shadow is tied to scroll position rather than
    // switched on once.
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        return stripOpacity();
      })
      .toBeLessThan(0.1);
  });

  test("expands the import/export section", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /System & Data/ }).click();

    const header = page.locator("#config-transfer").getByRole("button", { name: /Config Import\/Export/ });
    // The workspace re-renders when its config finishes loading, which can reset
    // a freshly toggled accordion, so retry the open until the body sticks.
    await expect(async () => {
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  });

  test("returns to the dashboard via Back", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: "Back to dashboard" }).first().click();
    await expect(page.getByLabel(/avatar$/)).toBeVisible({ timeout: 30_000 });
    // The zones panel itself, not its "Zones" heading: the layout hides that
    // heading, which is why helpers.ts waits on the panel (Adeline, 2026-09-21).
    // The panel, and a zone button inside it: the panel alone only proves the
    // shell mounted, and a dashboard that never loaded its zones is exactly the
    // half-loaded state these waits exist to catch (Adeline, 2026-09-21).
    await expect(page.locator(".zones-panel")).toBeVisible();
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
  });

  test("shows voice controls without a demo notice", async ({ page }) => {
    await gotoConfig(page);

    await page.getByRole("button", { name: /Voice & People/ }).click();
    await expect(page.getByText("Demo preview only.")).toHaveCount(0);
    await expect(page.getByText("Voice Infrastructure")).toBeVisible();
  });
});
