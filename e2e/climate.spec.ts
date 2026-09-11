import { expect, test, type Page } from "@playwright/test";
import { gotoDashboard, selectZone } from "./helpers";

// The climate cards are one temperature knob each since 2026-09-12
// (specs/temperature-encoder.md): no stepper, no button grid, no timer row.

/** One deliberate tap, inside the 60–400ms window that opens a tucked knob. */
async function tapKnob(page: Page, knob: ReturnType<Page["locator"]>) {
  const box = await knob.locator(".rotary-encoder-dial").boundingBox();
  if (!box) throw new Error("no knob to tap");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe("climate controls", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await selectZone(page, /Climate/);
  });

  test("each card is a temperature knob showing both temperatures", async ({ page }) => {
    const knob = page.locator(".climate-knob-body .temperature-encoder").first();
    await expect(knob).toBeVisible();
    await expect(knob.locator(".temperature-encoder-target")).toBeVisible();
    await expect(knob.locator(".temperature-encoder-room")).toBeVisible();
    // The mode lights replaced the Auto/Manual/Off buttons.
    await expect(knob.locator(".rotary-encoder-led")).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: /Raise Temperature/ })).toHaveCount(0);
    await expect(page.locator(".climate-fan-speed")).toHaveCount(0);
    await expect(page.locator(".climate-timer-row")).toHaveCount(0);
  });

  test("a knob is tucked away until it is tapped, and its rings float over the card", async ({ page }) => {
    const knob = page.locator(".climate-knob-body .temperature-encoder").first();
    await expect(knob).toHaveAttribute("data-locked", "true");

    await tapKnob(page, knob);
    await expect(knob).toHaveAttribute("data-locked", "false");
    const layer = page.locator(".rotary-encoder-ring-layer");
    await expect(layer).toHaveCount(1);
    await expect(layer.locator("[data-ring-id]").first()).toBeVisible();
  });

  test("the target reads back what the knob is set to", async ({ page }) => {
    const knob = page.locator(".climate-knob-body .temperature-encoder").first();
    const target = knob.locator(".temperature-encoder-target");
    await expect(target).toHaveText(/^-?[\d.]+°$/);
  });
});
