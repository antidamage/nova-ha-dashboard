import { expect, test } from "@playwright/test";
import { gotoConfig } from "./helpers";
import { openAccordion, paintOrderAt } from "./config.fixtures";

// The configuration workspace's breadcrumb trail: resting in the page column,
// then pinning to the icon line, and staying clear of the icons at a narrow
// viewport. The rest of the workspace is in config.spec.ts.

test.describe("configuration workspace", () => {
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
});
