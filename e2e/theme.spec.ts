import { expect, test, type Page } from "@playwright/test";
import { gotoConfig, gotoDashboard } from "./helpers";

// The theme editor section is rendered with `visibility: hidden` until the
// device theme finishes loading (themeReady), which removes it from the
// accessibility tree, so wait for the heading to become visible first.
async function waitForThemeEditor(page: Page) {
  const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
  const section = page.getByRole("button", { name: "Theme & Experience" });
  const target = page.getByRole("heading", { name: "Theme Library" });
  await expect(async () => {
    if (!(await section.isVisible())) {
      await category.click();
    }
    await expect(section).toBeVisible({ timeout: 2_000 });
    if (!(await target.isVisible())) {
      await section.click();
    }
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("theme", () => {
  test("applies the device theme variables to the document", async ({ page }) => {
    await gotoDashboard(page);
    // accentColor seeds the cyber palette onto :root; a non-empty value proves
    // the theme bootstrap ran rather than falling back to the unstyled default.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--cyber-cyan").trim(),
    );
    expect(accent).not.toEqual("");
  });

  test("renders the theme library controls", async ({ page }) => {
    await gotoConfig(page);
    await waitForThemeEditor(page);
    for (const action of ["Save", "Save As", "Duplicate"]) {
      await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
  });

  test("exposes dark and light theme editor tabs", async ({ page }) => {
    await gotoConfig(page);
    await waitForThemeEditor(page);
    await expect(page.getByRole("tab", { name: /Dark/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Light/ })).toBeVisible();
  });
});
