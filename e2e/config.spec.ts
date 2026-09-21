import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoConfig, watchConsole } from "./helpers";

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

  test("keeps the section trail in the flow, directly below the category menu", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /Appearance & Dashboard/ }).click();

    const header = page.locator("#appearance").getByRole("button", { name: "Theme & Experience" });
    await expect(async () => {
      await header.click();
      await expect(header).toHaveAttribute("aria-expanded", "true");
    }).toPass({ timeout: 15_000 });

    const trail = page.getByRole("navigation", { name: "Configuration section path" });
    await expect(trail).toBeVisible();
    // In the page's own flow, not a floating overlay pinned to the viewport.
    await expect(trail).not.toHaveCSS("position", "fixed");
    // "Just below the menu" is structural: the trail is the menu's next sibling,
    // not merely some element further down the page.
    await expect(page.locator(".config-category-nav + .config-breadcrumb")).toHaveCount(1);

    // One page-side read, in document coordinates: opening an accordion schedules
    // its own smooth scroll-into-view, so viewport boxes read across that scroll
    // could measure two different frames.
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`no ${selector} on the config page`);
        const rect = el.getBoundingClientRect();
        return { top: rect.top + window.scrollY, left: rect.left, width: rect.width, height: rect.height };
      };
      const menu = box(".config-category-nav");
      return { menuBottom: menu.top + menu.height, trail: box(".config-breadcrumb"), column: box(".config-layout") };
    });

    // Directly below: flush against the menu's bottom edge, within one grid gap.
    const gap = boxes.trail.top - boxes.menuBottom;
    expect(gap, "the trail sits directly under the menu").toBeGreaterThanOrEqual(0);
    expect(gap, "the trail sits directly under the menu").toBeLessThanOrEqual(40);
    // And it spans the config column rather than the whole viewport.
    expect(boxes.trail.left, "trail starts at the column's left edge").toBeCloseTo(boxes.column.left, 0);
    expect(boxes.trail.width, "trail spans the config column").toBeCloseTo(boxes.column.width, 0);
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
