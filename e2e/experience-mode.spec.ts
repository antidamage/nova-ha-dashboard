import { expect, test } from "@playwright/test";
import { gotoConfig, gotoDashboard, neutralizeTaskAlerts, seedExperienceMode } from "./helpers";

// First-run experience chooser + lite pathway. These tests deliberately avoid
// the seeding helpers where the first-run flow itself is under test: a fresh
// context has no stored mode, so the modal must appear exactly once.

test.describe("experience mode", () => {
  test("first run: choosing Lite persists, strips heavy features, and never asks again", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = page.getByRole("alertdialog", { name: "Choose your experience" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Lite" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator("html")).toHaveAttribute("data-nova-lite", "");
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible();
    await expect(page.getByLabel("Nova avatar")).toHaveCount(0);
    await expect(page.locator(".fluid-background")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-nova-lite", "");
    await expect(page.getByLabel("Nova avatar")).toHaveCount(0);
  });

  test("first run: choosing Full Experience keeps the rich pathway", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = page.getByRole("alertdialog", { name: "Choose your experience" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Full Experience" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByLabel("Nova avatar")).toBeVisible();
    await expect(page.locator(".fluid-background")).toHaveCount(1);
    await expect(page.locator("html")).not.toHaveAttribute("data-nova-lite");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Nova avatar")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("seeded devices never see the chooser", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("config checkboxes toggle each heavy feature independently and live", async ({ page }) => {
    await gotoConfig(page);

    const orb = page.getByRole("checkbox", { name: "Show Status Orb" });
    const background = page.getByRole("checkbox", { name: "Show Background" });
    const camera = page.getByRole("checkbox", { name: "Show Camera" });
    const worldMap = page.getByRole("checkbox", { name: "Show World Map" });
    for (const checkbox of [orb, background, camera, worldMap]) {
      await expect(checkbox).toBeVisible();
      await expect(checkbox).toHaveAttribute("aria-checked", "true");
    }

    // Turning off just the background is granular: the orb stays, and the
    // device is not flipped into full lite (no data-nova-lite kill-switch).
    await background.click();
    await expect(background).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("html")).not.toHaveAttribute("data-nova-lite");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
    await neutralizeTaskAlerts(page);
    await expect(page.getByLabel("Nova avatar")).toBeVisible();
    await expect(page.locator(".fluid-background")).toHaveCount(0);

    // Turning the remaining three off as well lands the device in full lite.
    await gotoConfig(page);
    await page.getByRole("checkbox", { name: "Show Status Orb" }).click();
    await page.getByRole("checkbox", { name: "Show Camera" }).click();
    await page.getByRole("checkbox", { name: "Show World Map" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-nova-lite", "");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
    await neutralizeTaskAlerts(page);
    await expect(page.getByLabel("Nova avatar")).toHaveCount(0);
    await expect(page.locator(".fluid-background")).toHaveCount(0);
  });

  test.describe("smooth scrolling", () => {
    // Force a known reduced-motion state so the rich assertions are deterministic
    // regardless of the runner's OS/browser default.
    test.use({ reducedMotion: "no-preference" });

    async function wheelIsHijacked(page: import("@playwright/test").Page): Promise<boolean> {
      // The engine calls preventDefault on a page-level vertical wheel; a native
      // (disabled) page leaves it uncancelled.
      return page.evaluate(() => {
        const event = new WheelEvent("wheel", { deltaY: 120, cancelable: true, bubbles: true });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      });
    }

    test("rich devices ease jumps via CSS and hijack the wheel via the engine", async ({ page }) => {
      await seedExperienceMode(page, "rich");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
      await neutralizeTaskAlerts(page);

      const behavior = await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      );
      expect(behavior).toBe("smooth");
      expect(await wheelIsHijacked(page)).toBe(true);
    });

    test("lite devices fall back to instant jumps and native wheel", async ({ page }) => {
      await seedExperienceMode(page, "lite");
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
      await neutralizeTaskAlerts(page);

      const behavior = await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      );
      expect(behavior).toBe("auto");
      expect(await wheelIsHijacked(page)).toBe(false);
    });
  });

  test("lite devices show the static map placeholder instead of the live map", async ({ page }) => {
    await seedExperienceMode(page, "lite");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Zones" })).toBeVisible({ timeout: 30_000 });
    await neutralizeTaskAlerts(page);

    await page.getByRole("button", { name: /world/i }).first().click();
    await expect(page.getByText("Map Offline")).toBeVisible();
    await expect(page.locator(".world-map-panel canvas")).toHaveCount(0);
  });
});
