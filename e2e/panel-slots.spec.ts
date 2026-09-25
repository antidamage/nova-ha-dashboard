import { expect, test, type Page } from "@playwright/test";
import { gotoConfig, gotoDashboard } from "./helpers";

// specs/control-modules.md, "Every panel holds slots" (Adeline, 2026-09-25):
// every dashboard panel that is not itself a modular control defaults to ONE
// slot holding its own content as a `panel-content` module — so an unconfigured
// dashboard is unchanged, node for node — and that content can be reassigned,
// moved or taken off from the Devices tab.

/**
 * The demo keeps its config in sessionStorage and merges what it finds there over
 * its own defaults, so a seed is the whole stored document with only the controls
 * block replaced. `mount` is given the derived controls and returns the block to
 * store.
 */
async function seedControls(page: Page, mount: (controls: Record<string, unknown>) => unknown) {
  const controls = await page.evaluate(async () =>
    (await (await fetch("/api/control-modules")).json()).controls);
  const stored = await page.evaluate(() => window.sessionStorage.getItem("nova.dashboard.demoConfig.v2"));
  if (!stored) throw new Error("the demo config was not in sessionStorage to seed from");
  const document_ = JSON.parse(stored);
  document_.dashboard.controls = mount(controls);
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("nova.dashboard.demoConfig.v2", JSON.stringify(value));
  }, document_);
  await page.reload({ waitUntil: "domcontentloaded" });
}

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
  // that the card's rows cannot hold the five modules at their own scale. The
  // card is 520px wide with three columns, and its rows are the column's height
  // divided between them (landscape.css: min(600px, 100dvh - 160px)).
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
  // Every slot shrinks by the same factor, so the card's dials stay one size.
  const widths = await card.locator("> *").evaluateAll((slots) =>
    slots.map((slot) => Math.round(slot.getBoundingClientRect().width)));
  expect(Math.max(...widths) - Math.min(...widths), "one slot width").toBeLessThanOrEqual(1);

  // Short enough that even the floor will not fit it: the card stops scaling and
  // scrolls instead, which is the over-packed case rather than a hidden control.
  await page.setViewportSize({ width: 1280, height: 500 });
  await gotoDashboard(page);
  await expect(card).toHaveAttribute("data-slot-fit", "scroll");
});

test("a room-inheriting control placed on a panel draws there", async ({ page }) => {
  // Review finding 1 of PR #51: a preset whose room is "inherit" (the default for
  // anything created in the Devices tab) resolved to no room on a panel, was
  // dropped as unusable, and drew nothing while the Devices tab listed it as
  // placed. A panel's slots inherit the PANEL's room.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: { id: string; roomId: string | null }[]; slots: object[] };
    return {
      configured: true,
      // The demo's own lighting preset, set to inherit — what anything created in
      // the Devices tab gets by default.
      presets: block.presets.map((preset) => (preset.id === "home-lights" ? { ...preset, roomId: null } : preset)),
      slots: [
        ...block.slots,
        { id: "clock-lights", presetId: "home-lights", roomId: null, surface: "clock", visible: true },
      ],
    };
  });
  const clock = page.locator(".clock-panel .panel-slots");
  await expect(clock.locator(".quick-segment-lights"), "the lighting dial the slot holds").toHaveCount(1);
  await expect(clock.locator(".clock-face"), "beside the clock's own content").toHaveCount(1);
});

test("the room menu keeps its own layout with a second module on it", async ({ page }) => {
  // Review finding 2 of PR #51: the slot grid renders inside the room menu, so
  // the moment anything else is placed there the panel's own child selectors
  // (`.zones-panel > .zone-selector-groups`) stopped matching and portrait lost
  // its stacked menu. The rules key on the class now.
  await page.setViewportSize({ width: 768, height: 1024 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: unknown[]; slots: object[] };
    return {
      configured: true,
      presets: block.presets,
      slots: [...block.slots, { id: "zones-outside", presetId: "outside", roomId: null, surface: "zones", visible: true }],
    };
  });
  await expect(page.locator(".zones-panel .panel-slots")).toHaveCount(1);
  const menu = await page.locator(".zones-panel .zone-selector-groups").evaluate((node) => {
    const style = getComputedStyle(node);
    return { direction: style.flexDirection, display: style.display, gap: style.gap };
  });
  expect(menu.display, "the menu is still the panel's own box").toBe("flex");
  expect(menu.direction, "and still stacks its groups").toBe("column");
});

test("a second module on a zone's panel does not break the stage's layout", async ({ page }) => {
  // The grid renders INSIDE the panel (Adeline: "the actual structure of the site
  // shouldn't change, we're just introducing modular slots for panel content"), so
  // the panel is still the stage's own child and the height chain the stylesheet
  // describes is untouched. What has to hold: the panel fills the stage, the stage
  // does not grow past its column, and the panel's own grid fits inside the panel.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: unknown[]; slots: object[] };
    return {
      configured: true,
      presets: block.presets,
      slots: [...block.slots, { id: "zone-outside", presetId: "outside", roomId: null, surface: "zone-panel", visible: true }],
    };
  });
  await expect(page.locator(".zone-panel .panel-slots").first()).toBeVisible();
  const measured = await page.evaluate(() => {
    const panel = document.querySelector(".zone-panel");
    const grid = panel?.querySelector(".panel-slots") ?? null;
    const stage = panel?.closest(".control-stage") as HTMLElement | null;
    const box = (node: Element | null | undefined) => (node ? node.getBoundingClientRect() : null);
    const panelBox = box(panel);
    const gridBox = box(grid);
    return {
      gridHeight: gridBox ? Math.round(gridBox.height) : 0,
      gridInside: panelBox && gridBox ? Math.round(panelBox.width - gridBox.width) : -1,
      panelHeight: panelBox ? Math.round(panelBox.height) : 0,
      panelSlots: grid ? grid.children.length : 0,
      stageClient: stage?.clientHeight ?? 0,
      stageScroll: stage?.scrollHeight ?? 0,
    };
  });
  expect(measured.panelSlots, "the zone panel holds both modules").toBe(2);
  expect(measured.gridHeight, "and its grid has room").toBeGreaterThan(0);
  expect(measured.stageScroll, "the stage does not grow past its column").toBeLessThanOrEqual(measured.stageClient + 1);
  expect(
    Math.abs(measured.panelHeight - measured.stageClient),
    "the panel still fills the stage, as it did before the grid was there",
  ).toBeLessThanOrEqual(2);
  expect(measured.gridInside, "and the grid sits inside the panel's own box").toBeGreaterThanOrEqual(0);
});

test("a module placed on a container-sized panel fills its column", async ({ page }) => {
  // Third-round review of PR #51: the wrapper's column was `max-content` for every
  // host, but the clock and the reminder bar are sized BY their container, not from
  // their content. A max-content track never stretches its item, so the clock
  // stopped filling the overview's column and the reminder bar could no longer
  // wrap — and the overview's hidden scrollbars cropped it. Widths are the
  // assertion, because a count cannot see either.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: unknown[]; slots: object[] };
    return {
      configured: true,
      presets: block.presets,
      slots: [
        ...block.slots,
        { id: "clock-outside", presetId: "outside", roomId: null, surface: "clock", visible: true },
        { id: "reminders-outside", presetId: "outside", roomId: null, surface: "reminders", visible: true },
      ],
    };
  });
  await expect(page.locator(".clock-panel .panel-slots")).toBeVisible();
  const measured = await page.evaluate(() => {
    const overview = document.querySelector(".dashboard-overview") as HTMLElement;
    const clock = document.querySelector(".clock-panel");
    const reminders = document.querySelector(".reminder-icon-bar .panel-slots, .reminder-icon-bar");
    const width = (node: Element | null | undefined) => (node ? Math.round(node.getBoundingClientRect().width) : -1);
    // The clock panel's own border sits inside the wrapper, so the wrapper is what
    // has to reach the column's width. The wrapper has no border of its own.
    return {
      clock: width(clock),
      clockSlots: clock ? [...clock.children].map((child) => Math.round(child.getBoundingClientRect().width)) : [],
      // Its CONTENT box: the overview carries a border of its own.
      overview: overview.clientWidth,
      reminders: width(reminders),
    };
  });
  expect(Math.abs(measured.clock - measured.overview), "the clock fills the overview's column").toBeLessThanOrEqual(2);
  // A module placed on it fills the panel's own content box, so it is narrower by
  // the panel's padding — not by a max-content track sized to its own content.
  for (const slot of measured.clockSlots) {
    expect(slot, "a module placed on it is not wider than the panel").toBeLessThanOrEqual(measured.overview);
    expect(measured.overview - slot, "and fills the panel's content box").toBeLessThanOrEqual(44);
  }
  expect(Math.abs(measured.reminders - measured.overview), "the reminder bar does too").toBeLessThanOrEqual(2);
});

test("a module on a zone's panel fills it in portrait too", async ({ page }) => {
  // Fourth-round review of PR #51: the stage wrapper's column followed the panel's
  // intrinsic width unconditionally, which is only right where the STAGE is
  // content-sized (landscape). In portrait the stage fills its card, and a zone's
  // panel is size-contained, so a max-content track laid it out as a sliver with
  // its controls spilling out. Widths, in portrait.
  await page.setViewportSize({ width: 430, height: 932 });
  await gotoDashboard(page);
  await seedControls(page, (controls) => {
    const block = controls as { presets: unknown[]; slots: object[] };
    return {
      configured: true,
      presets: block.presets,
      slots: [...block.slots, { id: "zone-outside", presetId: "outside", roomId: null, surface: "zone-panel", visible: true }],
    };
  });
  await expect(page.locator(".zone-panel .panel-slots").first()).toBeVisible();
  const measured = await page.evaluate(() => {
    const panel = document.querySelector(".zone-panel");
    const grid = panel?.querySelector(".panel-slots") ?? null;
    const width = (node: Element | null | undefined) => (node ? Math.round(node.getBoundingClientRect().width) : -1);
    return { grid: width(grid), parent: width(panel?.parentElement), panel: width(panel) };
  });
  expect(Math.abs(measured.panel - measured.parent), "the panel fills its container in portrait").toBeLessThanOrEqual(2);
  expect(measured.grid, "and its grid fits inside the panel").toBeLessThanOrEqual(measured.panel);
});
