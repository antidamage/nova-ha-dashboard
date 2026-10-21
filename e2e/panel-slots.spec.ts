import { expect, test } from "@playwright/test";
import { gotoConfig, gotoDashboard } from "./helpers";
import { seedControls } from "./panel-slots.fixtures";

// specs/control-modules.md, "Every panel holds slots" (Adeline, 2026-09-25):
// every dashboard panel that is not itself a modular control defaults to ONE
// slot holding its own content as a `panel-content` module — so an unconfigured
// dashboard is unchanged, node for node — and that content can be reassigned,
// moved or taken off from the Devices tab.
//
// This file covers the default slot, reassigning and listing panel content, old
// stored configurations and scaling; second modules on a panel are in
// panel-slots.modules.spec.ts.

test("an unconfigured dashboard draws no slot grid on its panels", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  // The card is a panel and carries the grid; nothing else does, because every
  // other panel holds only its own content — which is what "no visible change"
  // means for a stylesheet full of child selectors.
  await expect(page.locator(".quick-access-row")).toBeVisible();
  await expect(page.locator(".panel-slots")).toHaveCount(1);
  await expect(page.locator(".panel-slots-divides-height")).toHaveCount(1);
  // And the panels are still the panels: their own elements, their own children.
  await expect(page.locator(".clock-panel")).toHaveCount(1);
  await expect(page.locator(".zones-panel")).toHaveCount(1);
  // One per accordion group (Home and Systems each keep their own selection).
  await expect(page.locator(".zone-panel").first()).toBeVisible();
  await expect(page.locator(".clock-panel .clock-face")).toHaveCount(1);
  await expect(page.locator(".zones-panel > .zone-selector-groups")).toHaveCount(1);
});

test("a panel's own content can be reassigned from the Devices tab", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  // Put the outside readings on the CLOCK panel beside its own content: the
  // panel then holds two modules, and its slots are laid out by the same grid the
  // card uses.
  await seedControls(page, (controls) => {
    const block = controls as { presets: { id: string }[]; slots: { presetId: string }[] };
    return {
      configured: true,
      presets: block.presets,
      slots: [
        ...block.slots,
        { id: "clock-outside", presetId: "outside", roomId: null, surface: "clock", visible: true },
      ],
    };
  });
  // The grid wraps the panel's own element for a panel the page composes (the
  // clock, the tasks list, a zone's controls); for the room menu, which the page
  // cannot wrap without breaking its selectors, it renders inside.
  const clock = page.locator(".clock-panel .panel-slots");
  await expect(clock, "the clock panel now holds a grid").toHaveCount(1);
  await expect(clock.locator("> *"), "its own content and the readings tile").toHaveCount(2);
  await expect(clock.locator(".weather-readings, .quick-segment-weather"), "the module that was placed").toHaveCount(1);
  await expect(page.locator(".clock-panel .clock-face"), "its own content is still drawn").toHaveCount(1);
});

test("the Devices tab lists every panel's placements", async ({ page }) => {
  // The config page compiles a large chunk graph on first load; on this box that
  // cold compile can outlast the default budget (see e2e/controls-devices.spec.ts).
  test.setTimeout(90_000);
  await gotoConfig(page);
  await page.getByRole("button", { name: /Devices/ }).click();
  // The section's accordion starts closed and renders no body until it is opened.
  const section = page.locator("#controls");
  await expect(section).toHaveCount(1, { timeout: 30_000 });
  const trigger = section.locator("> .config-accordion-header .config-accordion-trigger");
  await trigger.scrollIntoViewIfNeeded();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // Each panel is a group of its own, with the slot list inside it.
  for (const surface of ["clock", "reminders", "zones", "zone-panel", "tasks"]) {
    await expect(page.locator(`#panel-slots-${surface}`), `${surface} panel group`).toHaveCount(1);
  }
  // And the panel's own content is one of the presets it can be given back.
  await expect(page.getByText("Panel's own content").first()).toBeVisible();
});

test("a stored configuration that predates the panel surfaces still draws every panel", async ({ page }) => {
  // THE regression test for the live breakage on 2026-09-25. A stored controls
  // block wins outright over the derivation, and every configuration saved before
  // this feature has no slots for the panel surfaces at all — so "this surface
  // has no slots" is the ordinary case, not the emptied one. Treating it as
  // "nothing is placed here" blanked the body of every panel on the page: the
  // live dashboard showed the orb, an empty time box, the card, and nothing else.
  // The demo has no stored configuration, which is why nothing here had caught it.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: unknown[]; slots: { surface: string }[] };
    return {
      configured: true,
      presets: block.presets,
      // Exactly what an install carries today: the card's slots and nothing else.
      slots: block.slots.filter((slot) => slot.surface === "quick-access"),
    };
  });
  await expect(page.locator(".clock-panel .clock-face"), "the clock").toHaveCount(1);
  await expect(page.locator(".zones-panel .zone-selector-groups"), "the room menu").toHaveCount(1);
  // One zone panel per accordion group (Home and Systems each keep a selection).
  await expect(page.locator(".zone-panel .mt-8").first(), "a zone's body").toBeVisible();
  await expect(page.locator(".zone-panel .zone-lighting-controls").first(), "with the zone's controls in it").toBeVisible();
  // And no panel grew a grid it has nothing to put in.
  await expect(page.locator(".panel-slots"), "only the card's own row").toHaveCount(1);
});

test("content scales down into its slot rather than being cropped", async ({ page }) => {
  // Adeline, 2026-09-25: "the content was meant to scale DOWN inside the slot, to
  // fit... get them scaling instead of cropping." A landscape column short enough
  // that the card's rows cannot hold what is placed on it at its own scale. The
  // card is 520px wide with two columns of dials and a line under them, and its rows
  // are the column's height divided between them (landscape.css: min(600px, 100dvh
  // - 160px)).
  const card = page.locator(".quick-access-row");

  await page.setViewportSize({ width: 1280, height: 600 });
  await gotoDashboard(page);
  await expect(card).toHaveAttribute("data-slot-fit", "scale");
  // The scale is a measurement, so it lands a frame or two after the card's own
  // layout does: wait for the slot width the measurement is made from.
  await page.waitForFunction(() => {
    const row = document.querySelector(".quick-access-row");
    if (!row) return false;
    const style = getComputedStyle(row);
    return parseFloat(style.getPropertyValue("--slot-width")) > 0
      && parseFloat(style.getPropertyValue("--slot-scale")) < 1;
  });
  const scaled = await card.evaluate((row) => ({
    overflow: row.scrollHeight - row.clientHeight,
    scale: parseFloat(getComputedStyle(row).getPropertyValue("--slot-scale")),
  }));
  expect(scaled.scale, "the content is drawn smaller than its slot needs").toBeLessThan(1);
  expect(scaled.scale, "and not smaller than the floor").toBeGreaterThanOrEqual(0.7);
  expect(scaled.overflow, "so nothing is cut off and nothing scrolls").toBeLessThanOrEqual(1);
  // Every DIAL slot shrinks by the same factor, so the card's dials stay one size.
  // The wide line slot is not one of them: it has its own factor (--wide-scale),
  // because the card's rows are the wrong budget for a one-line slot.
  const widths = await card.locator("> :not(.panel-slot-wide)").evaluateAll((slots) =>
    slots.map((slot) => Math.round(slot.getBoundingClientRect().width)));
  expect(Math.max(...widths) - Math.min(...widths), "one slot width").toBeLessThanOrEqual(1);

  // Short enough that even the floor will not fit it: the card stops scaling and
  // scrolls instead, which is the over-packed case rather than a hidden control.
  await page.setViewportSize({ width: 1280, height: 500 });
  await gotoDashboard(page);
  await expect(card).toHaveAttribute("data-slot-fit", "scroll");
});
