import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoConsoleErrors, gotoConfig, watchConsole } from "./helpers";

/** The viewport y of every matched element, so a scroll can be shown not to move them. */
const viewportY = (locator: Locator) =>
  locator.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().y)));

/**
 * Which elements really receive a press at their own centre, with the orb-shadow
 * strip made hit-testable. Hit-testing follows paint order, so this fails when
 * anything is painted over them — where comparing computed `z-index` values
 * cannot: a z-index only orders an element against its siblings inside its own
 * stacking context, and the band sat under the strip while 110 > 90 read true.
 *
 * The injected style is taken back out afterwards, because a hit-testable strip
 * would intercept clicks meant for the page behind it.
 */
async function paintOrderAt(page: Page, selectors: string[]) {
  await page.evaluate(() => {
    if (document.querySelector("style[data-nova-probe]")) {
      return;
    }
    const style = document.createElement("style");
    style.dataset.novaProbe = "strip-hit-testable";
    style.textContent = ".header-fade-strip { pointer-events: auto !important; }";
    document.head.append(style);
  });
  const hits = await page.evaluate((list) => {
    const hitIs = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`no ${selector} on the config page`);
      }
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };
    return Object.fromEntries(list.map((selector) => [selector, hitIs(selector)]));
  }, selectors);
  await page.evaluate(() => document.querySelector("style[data-nova-probe]")?.remove());
  return hits;
}

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

  test("keeps the header icons fixed, over the scroll shadow", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /System & Data/ }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    // Two copies exist (resting and pinned); both read the same chain, and the
    // resting one is the visible one at the top of the page.
    await expect(page.locator(".config-breadcrumb-slot .config-breadcrumb")).toContainText("Updates");

    const icons = page.locator(".dashboard-reload-link, .dashboard-back-link, .dashboard-logout-link");
    await expect(icons).toHaveCount(3);
    const strip = page.locator(".header-fade-strip");

    // How tall a category happens to be is not a test input: give the page
    // something to scroll whatever the panels measure.
    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    // The page is anchored at the top for the rest measurement. Polling the
    // opacity with the scroll re-applied inside it, rather than sleeping once and
    // trusting it: opening the section schedules its own smooth scroll into view
    // two frames later, and that can still move the page after our first
    // scrollTo, which reads as a lit strip at the top of the page.
    const stripOpacity = () => strip.evaluate((element) => Number(getComputedStyle(element).opacity));
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        return stripOpacity();
      })
      .toBeLessThan(0.1);
    const restingIcons = await viewportY(icons);

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(strip).toHaveCSS("opacity", "1");
    expect(await viewportY(icons), "the icons do not move with the page").toEqual(restingIcons);

    // In front of the shadow: the icons, and the trail once it has pinned.
    expect(
      await paintOrderAt(page, [
        ".dashboard-reload-link",
        ".dashboard-back-link",
        ".dashboard-logout-link",
        ".config-header-band .config-breadcrumb",
      ]),
    ).toEqual({
      ".dashboard-reload-link": true,
      ".dashboard-back-link": true,
      ".dashboard-logout-link": true,
      ".config-header-band .config-breadcrumb": true,
    });

    // ...and the reverse, so the shadow is tied to scroll position rather than
    // switched on once.
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 0));
        return stripOpacity();
      })
      .toBeLessThan(0.1);
  });

  test("rests the trail in the page column, then pins it to the icon line", async ({ page }) => {
    await gotoConfig(page);
    await page.getByRole("button", { name: /System & Data/ }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();

    const resting = page.locator(".config-breadcrumb-slot .config-breadcrumb");
    const pinned = page.locator(".config-header-band .config-breadcrumb");
    const slot = page.locator(".config-breadcrumb-slot");

    // At rest it is the page's own trail, in its row under the category menu.
    await expect(resting, "the trail rests in its own row").toContainText("Updates");
    await expect(resting).toBeVisible();
    // In flow (its own row), layered rather than pinned: `relative` gives it the
    // z-index that keeps the shadow off it on the way up, and it is not `fixed`
    // until the handover.
    await expect(resting).toHaveCSS("position", "relative");
    await expect(pinned, "nothing is pinned yet").toBeHidden();

    // The chip is the accent and its text takes that fill's tone (specs/slide-switch.md's
    // rule), not the page background's. Both halves are asserted, because on a theme
    // whose accent and background resolve to the same tone slot (the demo's does) the
    // colour check alone would be vacuous. On the owner's light variant the old
    // pairing — that tone on the old black chip — measured 1.36:1.
    const tone = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const chip = document.querySelector(".config-breadcrumb-slot .config-breadcrumb");
      const crumb = chip?.querySelector(".config-breadcrumb-crumb");
      if (!chip || !crumb) {
        throw new Error("no trail on the config page");
      }
      // The theme publishes `rgb(r g b)` while computed styles read back `rgb(r, g, b)`,
      // so compare on the digits alone.
      const digits = (value: string) => value.replace(/[^0-9.]/g, "");
      return {
        crumb: digits(getComputedStyle(crumb).color),
        onLine: digits(root.getPropertyValue("--cyber-title-on-line")),
        chip: digits(getComputedStyle(chip).backgroundColor),
        accentAtOpacity: digits(`${root.getPropertyValue("--cyber-line-rgb")} / 0.7`),
      };
    });
    expect(tone.crumb, "the crumb reads the accent chip's tone").toBe(tone.onLine);
    expect(tone.chip, "the chip itself is the accent").toBe(tone.accentAtOpacity);

    // Hovering must not change the tone: the crumb is still drawn on the accent
    // chip, and the reviewed round was a hover that switched to the highlight's
    // tone while nothing painted a highlight fill. Anchor the page at the top first,
    // because opening a section scrolls it into view and that can already have
    // pinned the trail (hiding the resting copy this hovers).
    await page.evaluate(() => window.scrollTo(0, 0));
    const restingCrumb = page.locator(".config-breadcrumb-slot .config-breadcrumb .config-breadcrumb-crumb").first();
    await expect(restingCrumb).toBeVisible();
    await restingCrumb.hover();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const crumb = document.querySelector(
            ".config-breadcrumb-slot .config-breadcrumb .config-breadcrumb-crumb",
          );
          if (!crumb) throw new Error("no crumb on the config page");
          const style = getComputedStyle(crumb);
          return {
            color: style.color.replace(/[^0-9.]/g, ""),
            decoration: style.textDecorationLine,
          };
        }),
      )
      .toEqual({ color: tone.onLine, decoration: "underline" });

    await page.evaluate(() => {
      document.body.style.minHeight = "3000px";
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    const rowHeight = await slot.evaluate((element) => Math.round(element.getBoundingClientRect().height));
    expect(rowHeight, "the trail's row has a height to give up").toBeGreaterThan(0);

    // On the way up — before it pins — the resting copy is still in front of the
    // shadow. It can only be, because the config column is deliberately not a
    // stacking context (background.css excludes .config-layout; layout.css lifts
    // the column's children and leaves the trail's slot unpositioned).
    await page.evaluate(() => window.scrollTo(0, 120));
    await expect(resting, "the trail is still resting on its way up").toBeVisible();
    expect(
      await paintOrderAt(page, [".config-breadcrumb-slot .config-breadcrumb"]),
      "the resting trail is not washed by the shadow",
    ).toEqual({ ".config-breadcrumb-slot .config-breadcrumb": true });

    // Scrolled past its position: the trail picks up into the band, on the icon
    // cluster's own line, and the resting copy goes invisible.
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(pinned, "the trail has picked up into the band").toBeVisible();
    await expect(resting).toBeHidden();
    const lines = await page.evaluate(() => {
      const top = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`no ${selector} on the config page`);
        return Math.round(element.getBoundingClientRect().top);
      };
      return { pinned: top(".config-header-band .config-breadcrumb"), reload: top(".dashboard-reload-link") };
    });
    expect(lines.pinned, "the pinned trail sits on the icon cluster's line").toBe(lines.reload);

    // The row it came from keeps its height, so nothing below the trail moved.
    expect(
      await slot.evaluate((element) => Math.round(element.getBoundingClientRect().height)),
      "the trail's row still measures what it did",
    ).toBe(rowHeight);

    // Narrow viewport: the pinned trail shares this line with the icon cluster
    // and has to stop clear of it whatever the chain's width. A three-crumb chain
    // at 600px used to reach over Log out and take its clicks, because the trail
    // is later in the DOM.
    await page.setViewportSize({ width: 600, height: 800 });
    await page.getByRole("button", { name: /Voice & People/ }).click();
    await openAccordion(page, "user-data");
    await openAccordion(page, "face-enrolment");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(pinned).toContainText("Face Enrolment");
    await expect(pinned).toBeVisible();

    const band = await page.evaluate(() => {
      const trailBox = document.querySelector(".config-header-band .config-breadcrumb")?.getBoundingClientRect();
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

    // Back at the top it rests again, exactly where it was.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(resting, "the trail is back in its row").toBeVisible();
    await expect(pinned).toBeHidden();
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
