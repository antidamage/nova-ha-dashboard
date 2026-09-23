import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoConsoleErrors, gotoConfig, watchConsole } from "./helpers";

/** The viewport y of every matched element, so a scroll can be shown not to move them. */
const viewportY = (locator: Locator) =>
  locator.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().y)));

/**
 * Open a config accordion by id, retrying. The workspace re-renders when its
 * config finishes loading, which can reset a freshly toggled accordion — the
 * same reason the other cases in this file retry their opens.
 */
async function openAccordion(page: Page, id: string) {
  const trigger = page.locator(`#${id} > .config-accordion-header > .config-accordion-trigger`);
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  }).toPass({ timeout: 20_000 });
}

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

  test("pins the header icons and the trail over the scroll shadow", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /System & Data/ }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await expect(page.locator(".config-breadcrumb")).toContainText("Updates");

    // The three fixed icons, read as the row they are, plus the trail — which
    // floats over the page now rather than sitting under the category menu.
    const icons = page.locator(".dashboard-reload-link, .dashboard-back-link, .dashboard-logout-link");
    await expect(icons).toHaveCount(3);
    const trail = page.locator(".config-breadcrumb");
    const strip = page.locator(".header-fade-strip");
    await expect(trail).toHaveCSS("position", "fixed");

    // How tall a category happens to be is not a test input: give the page
    // something to scroll whatever the panels measure.
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    // The section that just opened is scrolled into view on a deferred frame,
    // so let that land before anchoring the page at the top.
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    // Not exactly "0": Chrome's scroll anchoring can leave a pixel or two of
    // scroll behind, which is a fraction of a percent of the strip's opacity.
    const stripOpacity = () => strip.evaluate((element) => Number(getComputedStyle(element).opacity));
    await expect.poll(stripOpacity).toBeLessThan(0.1);
    const restingIcons = await viewportY(icons);
    const restingTrail = await viewportY(trail);

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(strip).toHaveCSS("opacity", "1");

    // Fixed: neither the three icons nor the trail moved with the page.
    expect(await viewportY(icons)).toEqual(restingIcons);
    expect(await viewportY(trail)).toEqual(restingTrail);

    // In front of the shadow — and that is paint order, not z-index numbers. A
    // z-index only orders an element against its own siblings inside its stacking
    // context, so comparing computed z-indexes across one proves nothing: 110 > 90
    // read true here while the whole column, the icons and the trail with it, was
    // painting UNDER the strip. Make the strip hit-testable (it is
    // `pointer-events: none`) and ask which element is really at each one's
    // centre — hit-testing follows paint order, so this fails when anything covers
    // them.
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.dataset.novaProbe = "strip-hit-testable";
      style.textContent = ".header-fade-strip { pointer-events: auto !important; }";
      document.head.append(style);
    });
    const painted = await page.evaluate(() => {
      const hitIs = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) {
          throw new Error(`no ${selector} on the config page`);
        }
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return Boolean(hit && (hit === element || element.contains(hit)));
      };
      return {
        reload: hitIs(".dashboard-reload-link"),
        back: hitIs(".dashboard-back-link"),
        logout: hitIs(".dashboard-logout-link"),
        trail: hitIs(".config-breadcrumb"),
      };
    });
    expect(painted, "the band paints in front of the orb shadow strip").toEqual({
      reload: true,
      back: true,
      logout: true,
      trail: true,
    });
    // Take the probe back out: with the strip hit-testable it would intercept
    // clicks meant for the page in the steps below.
    await page.evaluate(() => document.querySelector("style[data-nova-probe]")?.remove());

    // ...and the reverse, so the shadow is tied to scroll position rather than
    // switched on once.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(stripOpacity).toBeLessThan(0.1);

    // Narrow band: the trail shares this line with the icon cluster, and it has
    // to stop clear of it whatever the chain's width. A three-crumb chain at
    // 600px used to reach over Log out and take its clicks, because the trail is
    // later in the DOM and both sat at the same z-index.
    await page.setViewportSize({ width: 600, height: 800 });
    await page.getByRole("button", { name: /Voice & People/ }).click();
    await openAccordion(page, "user-data");
    await openAccordion(page, "face-enrolment");
    await expect(trail).toContainText("Face Enrolment");

    const band = await page.evaluate(() => {
      const trailBox = document.querySelector(".config-breadcrumb")?.getBoundingClientRect();
      const logoutBox = document.querySelector(".dashboard-logout-link")?.getBoundingClientRect();
      if (!trailBox || !logoutBox) {
        throw new Error("the band's two occupants are not both mounted");
      }
      const hit = document.elementFromPoint(
        logoutBox.left + logoutBox.width / 2,
        logoutBox.top + logoutBox.height / 2,
      );
      return {
        width: Math.round(trailBox.width),
        gap: Math.round(trailBox.left - logoutBox.right),
        logoutHit: Boolean(hit?.closest(".dashboard-logout-link")),
      };
    });
    expect(band.width, "the trail is capped rather than its content's width").toBeLessThan(300);
    expect(band.gap, "the trail stops clear of the icon cluster").toBeGreaterThan(0);
    expect(band.logoutHit, "Log out is the element at its own centre").toBe(true);
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
