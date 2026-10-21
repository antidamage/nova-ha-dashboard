import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";
import { seedControls } from "./panel-slots.fixtures";

// specs/control-modules.md, "Every panel holds slots" (Adeline, 2026-09-25):
// a second module placed on a panel — a room-inheriting control, the room menu,
// a zone's panel in landscape and portrait, a container-sized panel — draws
// there without breaking the layout. The default slot and reassignment are in
// panel-slots.spec.ts.

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
