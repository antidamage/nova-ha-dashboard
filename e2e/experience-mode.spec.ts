import { expect, test } from "@playwright/test";
import { gotoConfig, gotoDashboard, neutralizeTaskAlerts, seedExperienceMode } from "./helpers";

async function openThemeExperience(page: Parameters<typeof gotoConfig>[0]) {
  const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
  // Both triggers are scoped to their own accordion: the breadcrumb renders a
  // button of the same name once the section is open (numeric-entry.spec.ts).
  const section = page.locator("#appearance").getByRole("button", { name: "Theme & Experience" });
  const thisDevice = page.locator("#this-device").getByRole("button", { name: "This Device" });
  const target = page.getByRole("switch", { name: "Show Status Orb", exact: true });
  await expect(async () => {
    if (!(await section.isVisible())) {
      await category.click();
    }
    await expect(section).toBeVisible({ timeout: 2_000 });
    // The feature switches live in the "This Device" accordion, which starts
    // collapsed.
    if (!(await thisDevice.isVisible())) {
      await section.click();
    }
    await expect(thisDevice).toBeVisible({ timeout: 2_000 });
    if (!(await target.isVisible())) {
      await thisDevice.click();
    }
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

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
    // The zones panel itself, not its "Zones" heading: the layout hides that
    // heading, which is why helpers.ts waits on the panel (Adeline, 2026-09-21).
    // The panel, and a zone button inside it: the panel alone only proves the
    // shell mounted, and a dashboard that never loaded its zones is exactly the
    // half-loaded state these waits exist to catch (Adeline, 2026-09-21).
    await expect(page.locator(".zones-panel")).toBeVisible();
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
    await expect(page.getByLabel(/avatar$/)).toHaveCount(0);
    await expect(page.locator(".fluid-background")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".zones-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-nova-lite", "");
    await expect(page.getByLabel(/avatar$/)).toHaveCount(0);
  });

  test("first run: choosing Full Experience keeps the rich pathway", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const dialog = page.getByRole("alertdialog", { name: "Choose your experience" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Full Experience" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByLabel(/avatar$/)).toBeVisible();
    await expect(page.locator(".fluid-background")).toHaveCount(1);
    await expect(page.locator("html")).not.toHaveAttribute("data-nova-lite");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/avatar$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("seeded devices never see the chooser", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("config switches toggle each heavy feature independently and live", async ({ page }) => {
    await gotoConfig(page);
    await openThemeExperience(page);

    // These rows are SlideSwitches, not checkboxes: role="switch" with
    // aria-checked, the label as the accessible name (specs/slide-switch.md).
    const orb = page.getByRole("switch", { name: "Show Status Orb", exact: true });
    const background = page.getByRole("switch", { name: "Show Background" });
    const camera = page.getByRole("switch", { name: "Show Camera" });
    const worldMap = page.getByRole("switch", { name: "Show World Map" });
    for (const control of [orb, background, camera, worldMap]) {
      await expect(control).toBeVisible();
      await expect(control).toHaveAttribute("aria-checked", "true");
    }

    // Turning off just the background is granular: the orb stays, and the
    // device is not flipped into full lite (no data-nova-lite kill-switch).
    await background.click();
    await expect(background).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("html")).not.toHaveAttribute("data-nova-lite");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zones-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
    await neutralizeTaskAlerts(page);
    await expect(page.getByLabel(/avatar$/)).toBeVisible();
    await expect(page.locator(".fluid-background")).toHaveCount(0);

    // Turning the remaining three off as well lands the device in full lite.
    await gotoConfig(page);
    await openThemeExperience(page);
    await page.getByRole("switch", { name: "Show Status Orb", exact: true }).click();
    await page.getByRole("switch", { name: "Show Camera" }).click();
    await page.getByRole("switch", { name: "Show World Map" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-nova-lite", "");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zones-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
    await neutralizeTaskAlerts(page);
    await expect(page.getByLabel(/avatar$/)).toHaveCount(0);
    await expect(page.locator(".fluid-background")).toHaveCount(0);
  });

  test("lite devices show the static map placeholder instead of the live map", async ({ page }) => {
    await seedExperienceMode(page, "lite");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zones-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".zones-panel .zone-button").first()).toBeVisible();
    await neutralizeTaskAlerts(page);

    await page.getByRole("button", { name: /world/i }).first().click();
    await expect(page.getByText("Map Offline")).toBeVisible();
    await expect(page.locator(".world-map-panel canvas")).toHaveCount(0);
  });
});
