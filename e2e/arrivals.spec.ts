import { expect, test } from "@playwright/test";
import { gotoConfig, watchConsole } from "./helpers";

/** The config page's fluid background cannot compile its shader under headless
 * Chromium, which is the suite's known pre-existing console red — the same error
 * `config.spec.ts`'s no-console-errors case fails on at the base. */
const KNOWN_CONSOLE_RED = /fluid background|shader compile/i;

test.describe("arrival and departure configuration", () => {
  test("opens under Voice & People → User Data and adds a member", async ({ page }) => {
    const console = watchConsole(page);
    await gotoConfig(page);

    await page.getByRole("button", { name: /Voice & People/ }).click();

    const userData = page.locator("#user-data").getByRole("button", { name: /User Data/ });
    const arrival = page.locator("#arrival").getByRole("button", { name: /Household members/ });

    // The workspace re-renders when its config lands, which can reset a freshly
    // toggled accordion, so retry the open until the body sticks.
    await expect(async () => {
      await userData.click();
      await arrival.click();
      await expect(arrival).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: "Add person" })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The demo build ships no household people, so the section shows its empty
    // state rather than inventing names.
    await expect(page.getByText(/No household people are configured yet/i)).toBeVisible();

    await page.getByRole("button", { name: "Add person" }).click();
    await expect(page.getByLabel("Person name")).toHaveValue("New person");
    await expect(page.getByText("/api/arrival/new-person")).toBeVisible();

    // An empty state, not an error state: with no presets anywhere, Add state
    // says so rather than offering one it could not save.
    await expect(page.getByText(/No presets are available yet/i).first()).toBeVisible();

    const unexpected = console.errors.filter((line) => !KNOWN_CONSOLE_RED.test(line));
    expect(unexpected).toEqual([]);
  });
});
