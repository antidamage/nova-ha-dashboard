import { expect, test } from "@playwright/test";
import { gotoConfig } from "./helpers";

// A press on a slider used to move it. It now defers, so a press-and-release
// that never moved can mean "let me type this number instead".
test.describe("slider numeric entry", () => {
  test("tapping a config slider opens a focused numeric field", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /Appearance & Dashboard/ }).click();
    // Apple TV Expert Settings is a plain column of sliders, so it needs no
    // colour modal opened first to have one on screen.
    const section = page.getByRole("button", { name: "Apple TV Expert Settings" });
    await expect(async () => {
      await section.click();
      await expect(section).toHaveAttribute("aria-expanded", "true");
    }).toPass({ timeout: 15_000 });

    const slider = page.locator('[role="slider"]').first();
    await expect(slider).toBeVisible({ timeout: 20_000 });
    await slider.scrollIntoViewIfNeeded();
    const before = await slider.getAttribute("aria-valuenow");

    // A plain click is exactly the gesture under test: press and release with
    // no movement in between.
    await slider.click();

    const field = page.getByRole("dialog").getByRole("textbox");
    await expect(field).toBeFocused();
    // The tap itself must not have moved the value it was asked about.
    expect(await slider.getAttribute("aria-valuenow")).toBe(before);

    await page.keyboard.press("Escape");
    await expect(field).toBeHidden();
    expect(await slider.getAttribute("aria-valuenow")).toBe(before);
  });
});
