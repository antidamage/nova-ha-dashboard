import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoDashboard, watchConsole } from "./helpers";

// The default zone in the demo fixtures has light devices, so its lighting
// controls render on load without needing to navigate first.
test.describe("lighting controls", () => {
  test("renders the colour dial and preset controls", async ({ page }) => {
    await gotoDashboard(page);

    const dial = page.locator(".zone-panel").getByLabel("Zone colour");
    await expect(dial).toBeVisible();
    await expect(dial).toHaveAttribute("aria-valuenow", /\d+/);
    // The dial owns brightness; there is no second brightness control.
    await expect(page.getByLabel("Brightness")).toHaveCount(0);

    await expect(page.locator(".zone-panel").getByRole("button", { name: /^On/ }).first()).toBeVisible();
    await expect(page.locator(".zone-panel").getByRole("button", { name: "Off", exact: true })).toBeVisible();
  });

  test("opens on brightness and cycles through saturation and hue", async ({ page }) => {
    await gotoDashboard(page);
    const dial = page.locator(".zone-panel").getByLabel("Zone colour");

    // Dimming a room is what this card is reached for, so brightness is lit
    // on load rather than hue (specs/color-encoder.md, "Channels").
    await expect(dial).toHaveAttribute("data-channel", "brightness");
    await dial.click();
    await expect(dial).toHaveAttribute("data-channel", "saturation");
    await dial.click();
    await expect(dial).toHaveAttribute("data-channel", "hue");
    await dial.click();
    await expect(dial).toHaveAttribute("data-channel", "brightness");
  });

  test("dragging left on the brightness light turns the zone down", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);
    const dial = page.locator(".zone-panel").getByLabel("Zone colour");
    await expect(dial).toHaveAttribute("data-channel", "brightness");

    // The drag is driven by page coordinates, so the dial has to be on screen
    // for them to mean anything.
    await dial.scrollIntoViewIfNeeded();
    const box = await dial.boundingBox();
    if (!box) throw new Error("dial has no box");
    const before = Number(await dial.getAttribute("aria-valuenow"));
    expect(before).toBeGreaterThan(0);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 6 });
    await page.mouse.up();

    await expect.poll(async () => Number(await dial.getAttribute("aria-valuenow"))).toBeLessThan(before);
    expectNoConsoleErrors(console);
  });

  test("toggles the zone off and back on without errors", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);

    await page.locator(".zone-panel").getByRole("button", { name: "Off", exact: true }).click();
    // Re-fetching the On control after the toggle keeps the locator fresh.
    await page.locator(".zone-panel").getByRole("button", { name: /^On/ }).first().click();

    // Controls remain interactive after a round trip through the command path.
    await expect(page.locator(".zone-panel").getByLabel("Zone colour")).toBeVisible();
    expectNoConsoleErrors(console);
  });

  test("applies a colour preset", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);

    await page.locator(".zone-panel").getByRole("button", { name: "White", exact: true }).click();
    await expect(page.locator(".zone-panel").getByLabel("Zone colour")).toBeVisible();
    expectNoConsoleErrors(console);
  });
});
