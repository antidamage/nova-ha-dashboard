import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoConfig, watchConsole } from "./helpers";
import { degreesFor, expectGeometry, setSize, shot, turnDial } from "./color-encoder.fixtures";

// The rotary colour control on the config page (specs/color-encoder.md): inline
// at 100px, with the alpha light where the slot owns its opacity. The zone
// panel's dial is in color-encoder.spec.ts.

test.describe("colour encoder", () => {
  test("config dial: inline, 100px, alpha light where the slot owns one", async ({ page }) => {
    const console = watchConsole(page);
    await gotoConfig(page);
    const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
    const levels = ["Theme & Experience", "Theme Settings", "Theme Colours"].map((name) =>
      page.locator(".config-accordion-trigger", { hasText: name }).first());
    await expect(async () => {
      if (!(await levels[0].isVisible())) await category.click();
      for (const level of levels) {
        await expect(level).toBeVisible({ timeout: 2_000 });
        if ((await level.getAttribute("aria-expanded")) !== "true") await level.click();
      }
      await expect(page.locator(".theme-widget-cell").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The dials are on the page itself: no swatch card, and no modal to open.
    await expect(page.locator(".theme-display-card")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const accent = page.locator(".theme-widget-cell", { hasText: "ACCENT" }).first().locator(".color-encoder");
    await accent.scrollIntoViewIfNeeded();
    await expectGeometry(accent, 100);
    await expect(accent.locator(".rotary-encoder-led")).toHaveCount(3);
    // Label and channel caption are the only text: no value, no hex.
    expect((await accent.textContent())?.trim()).toBe("AccentHUE");
    await shot(accent, "config-accent-100");

    // Border owns its opacity, so its dial has the fourth (alpha) light.
    const border = page.locator(".theme-widget-cell", { hasText: "BORDERS" }).first().locator(".color-encoder");
    await border.scrollIntoViewIfNeeded();
    await expect(border.locator(".rotary-encoder-led")).toHaveCount(4);
    await expectGeometry(border, 100);
    await expect(page.getByLabel(/borders opacity/i)).toHaveCount(0);

    // Take opacity to 40% and check the checkerboard shows through.
    const dial = border.locator(".rotary-encoder-dial");
    for (let index = 0; index < 3; index += 1) await dial.click();
    await expect(dial).toHaveAttribute("data-led", "alpha");
    const before = Number(await dial.getAttribute("aria-valuenow"));
    await turnDial(page, dial, degreesFor(40 - before));
    await expect.poll(async () => Number(await dial.getAttribute("aria-valuenow"))).toBe(40);
    const ringColour = await border.locator(".rotary-encoder-ring").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(ringColour).toMatch(/rgba\(.*, 0\.\d+\)/);
    await shot(border, "config-border-100-alpha");
    await shot(page.locator(".theme-widget-flow").first(), "config-colour-grid");
    await setSize(border, 200);
    await shot(border, "config-border-at-200-opacity");
    expectNoConsoleErrors(console);
  });
});
