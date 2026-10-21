import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";
import { drawnRows, waitForSlots } from "./quick-access-slots.fixtures";

// specs/quick-access-card.md, "The layout slots" (Adeline, 2026-09-25): content
// scales to its slot, so a roomier slot draws a bigger dial, and with nothing
// placed on the line it collapses and the dials take the whole card. The grid
// and its line across viewports are in quick-access-slots.spec.ts.

test("a slot with more room draws a bigger dial", async ({ page }) => {
  // The content scales to its slot (Adeline, 2026-09-25): the same five modules
  // in a 2x2 card's wider slots draw larger dials than the kiosk's, and the
  // card's dials never shrink below the knob's own floor however narrow it gets.
  const sizes: Record<string, number> = {};
  for (const viewport of [
    { name: "820x1180", width: 820, height: 1180 },
    { name: "1920x1080", width: 1920, height: 1080 },
    { name: "375x812", width: 375, height: 812 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await gotoDashboard(page);
    await waitForSlots(page);
    const drawn = await drawnRows(page);
    if (!drawn) throw new Error("no .quick-access-row");
    const dials = drawn.rows.flatMap((row) => row.slots).filter((slot) => slot.dial !== null);
    sizes[viewport.name] = dials[0].dial ?? 0;
    // The knob's own floor: a temperature knob's smallest legible size is 100px,
    // which is 131.4px across its dial.
    expect(sizes[viewport.name], `${viewport.name}: never below the knob's floor`).toBeGreaterThanOrEqual(131);
  }
  expect(sizes["820x1180"], "the wider slot draws the bigger dial").toBeGreaterThan(sizes["1920x1080"]);
  // And the dial the card draws at 520px has grown past the floor the old 3x2
  // arrangement was pinned to.
  expect(sizes["1920x1080"], "roomier per dial than the 3x2 the card used to draw").toBeGreaterThan(140);
});

/**
 * The card with FOUR modules on it — the arrangement Adeline named. The demo's
 * own derived controls, from the app itself, with the readings tile taken off; the
 * demo keeps its config in sessionStorage and merges what it finds there over its
 * defaults, so the seed is the whole stored document with only the controls block
 * replaced.
 */
async function seedWithoutReadings(page: import("@playwright/test").Page) {
  const controls = await page.evaluate(async () =>
    (await (await fetch("/api/control-modules")).json()).controls);
  const four = {
    ...controls,
    configured: true,
    presets: controls.presets.filter((preset: { id: string }) => preset.id !== "outside"),
    slots: controls.slots.filter((slot: { presetId: string }) => slot.presetId !== "outside"),
  };
  const stored = await page.evaluate(() => window.sessionStorage.getItem("nova.dashboard.demoConfig.v2"));
  if (!stored) throw new Error("the demo config was not in sessionStorage to seed from");
  const document_ = JSON.parse(stored);
  document_.dashboard.controls = four;
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("nova.dashboard.demoConfig.v2", JSON.stringify(value));
  }, document_);
  await page.reload({ waitUntil: "domcontentloaded" });
}

test("with nothing on the line it collapses, and the dials take the whole card", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await seedWithoutReadings(page);
  await waitForSlots(page, 4);
  const drawn = await drawnRows(page);
  if (!drawn) throw new Error("no .quick-access-row");

  // Four dials and no line at all: no slot, no row, nothing reserved for it.
  expect(page.locator(".quick-access-row > .panel-slot-wide"), "the line is not there").toHaveCount(0);
  expect(drawn.columns, "four dials are two columns").toBe(2);
  expect(drawn.rows.length, "and two rows").toBe(2);
  expect(drawn.overflowY, "a 2x2 card fits its column").toBeLessThanOrEqual(1);
  for (const row of drawn.rows) {
    expect(row.slots.length, "both rows are full").toBe(2);
    expect(Math.abs(row.h - drawn.rows[0].h), "the rows are the same height").toBeLessThanOrEqual(1);
    for (const slot of row.slots) {
      // Each slot holds what it draws: the knob's own preset band is inside the
      // row it was given, which is what the measure has to account for.
      expect(slot.needs, `${slot.cls}: content inside its slot`).toBeLessThanOrEqual(row.h + 1);
    }
  }
  const dials = drawn.rows.flatMap((row) => row.slots).filter((slot) => slot.dial !== null);
  expect(new Set(dials.map((slot) => slot.dial)).size, "one dial size for the card").toBe(1);
  // The dials divide the whole card rather than a third of it: roomier than the
  // same card with a line under them.
  expect(dials[0].dial, "no height given away to a line that is not there").toBeGreaterThan(160);
});
