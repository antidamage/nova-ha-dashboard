import { expect, test } from "@playwright/test";
import { gotoConfig, watchConsole, type ConsoleWatcher } from "./helpers";

// specs/control-modules.md: the Devices tab is a list of device types, each with
// its own presets under it, and a preset is a tappable row that opens its editor.
// The demo supplies the same shape the dashboard server does, so this drives the
// real surface rather than a fixture of it.

/**
 * The config page's preview background cannot compile its shader in this
 * headless environment, and says so on the console. It reproduces at the base
 * commit with nothing of this change applied (`e2e/config.spec.ts`'s own
 * no-console-errors case fails there for the same reason), so it is filtered
 * here rather than counted against this surface.
 */
const ENVIRONMENT_NOISE = /failed to initialize fluid background/i;

function expectNoNewConsoleErrors(watcher: ConsoleWatcher) {
  const errors = watcher.errors.filter((text) => !ENVIRONMENT_NOISE.test(text));
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
}

/** The config page's accordions start closed and render no body until opened. */
async function openSection(page: import("@playwright/test").Page, id: string) {
  const section = page.locator(`#${id}`);
  const trigger = section.locator("> .config-accordion-header .config-accordion-trigger");
  await trigger.scrollIntoViewIfNeeded();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return section;
}

// The config page compiles a large chunk graph on first load, and on a throttled
// box that cold compile can outlast the default per-test budget before a single
// assertion runs — the failure reads as a missing section rather than a slow one.
test.describe.configure({ timeout: 90_000 });

test.describe("controls and devices", () => {
  test("lists device types with their presets, and opens a preset", async ({ page }) => {
    const console = watchConsole(page);
    await gotoConfig(page);
    await page.getByRole("button", { name: /Devices/ }).click();

    const section = await openSection(page, "controls");

    // The other half of the model: what the card is actually showing, in order.
    await expect(section.getByRole("heading", { name: "Quick Access" })).toBeVisible();
    await expect(section.locator(".slot-row")).toHaveCount(5);
    await expect(section.locator(".slot-row").first()).toContainText("Lights");

    // Device types, closed by default, drivers among them.
    const aircon = section.getByRole("button", { name: /^Air Conditioner \/ Heater/ });
    await expect(aircon).toBeVisible();
    await expect(section.getByRole("button", { name: /^Room Lighting/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /^Gree Air Conditioner/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /^Sample Heater WiFi Switch/ })).toBeVisible();
    // Nothing under a type until it is opened.
    await expect(section.locator(".preset-row")).toHaveCount(0);

    await aircon.click();
    await expect(aircon).toHaveAttribute("aria-expanded", "true");
    const presets = section.locator(`#device-type-aircon-heater-control .preset-row`);
    await expect(presets).toHaveCount(2);
    await expect(presets.first()).toContainText("Air Conditioner");
    await expect(presets.first()).toContainText("Gree Air Conditioner");
    await expect(presets.nth(1)).toContainText("Bedroom Heater");

    // Tapping one opens its editor, generated from the module and its driver.
    await presets.first().click();
    const dialog = page.getByRole("dialog", { name: "Edit Air Conditioner" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Runs on" })).toContainText("Gree Air Conditioner");
    await expect(dialog.getByRole("button", { name: "This control is" })).toContainText("Air conditioner");
    await expect(dialog.getByRole("button", { name: "HA room" })).toBeVisible();
    // The Gree driver's own fields, not the control's: a unit is bound by entity.
    await expect(dialog.getByRole("button", { name: "Climate entity" })).toBeVisible();
    await expect(dialog.getByText("Behaviour this control links into")).toBeVisible();
    // And its auxiliary switches are a feature of that driver.
    await expect(dialog.getByRole("checkbox", { name: /Quiet \/ Turbo \/ Fresh air/ })).toBeVisible();

    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    expectNoNewConsoleErrors(console);
  });

  test("a heater preset names the switch driver and its grouped sensors", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /Devices/ }).click();
    const section = await openSection(page, "controls");

    await section.getByRole("button", { name: /^Air Conditioner \/ Heater/ }).click();
    await section.locator("#device-type-aircon-heater-control .preset-row").nth(1).click();

    const dialog = page.getByRole("dialog", { name: "Edit Bedroom Heater" });
    await expect(dialog.getByRole("button", { name: "Runs on" })).toContainText("Sample Heater WiFi Switch");
    await expect(dialog.getByRole("button", { name: "This control is" })).toContainText("Heater");
    // The driver's required list is shown as ordered chips, not a text box.
    await expect(dialog.locator(".device-field-id").first()).toContainText("switch.bedroom_heater");
    await expect(dialog.getByText("Nothing bound yet.")).toHaveCount(0);
  });
});
