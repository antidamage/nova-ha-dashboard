import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";
import { dials, expectRingsOnScreen, places, tap } from "./quick-access-portrait.fixtures";

// specs/quick-access-card.md, portrait (Adeline, 2026-09-14, revised
// 2026-09-25): the card is a GRID of DIAL slots with a wide line slot under it, and
// every dial slot is the same width. Portrait's grid is the 2x2 wherever two slots
// can still hold a knob's rings — the wide screen and a tablet — and one column of
// four on a phone, and the rings of a knob that is untucked stay on screen either
// way. Below one slot's width every dial shrinks together, floor 100px.
// The preset rows, the playlist wrap and the narrow-phone floor are in
// quick-access-portrait.presets.spec.ts.
// QUICK_ACCESS_SHOTS=<dir> keeps a screenshot of the card at each viewport.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;

const PHONES = [
  { name: "iphone-pro-max", width: 440, height: 956 },
  { name: "iphone", width: 375, height: 812 },
  { name: "narrow", width: 300, height: 640 },
];

for (const phone of PHONES) {
  test(`portrait ${phone.name}: the dials are one grid, the pair never overlapping`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await gotoDashboard(page);
    const row = page.locator(".quick-access-row");
    await row.scrollIntoViewIfNeeded();
    await expect(dials(page)).toHaveCount(4);

    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error("no row box");
    const rowCentre = rowBox.x + rowBox.width / 2;
    const [lights, amp, aircon, heater] = await places(page);

    // Every dial is the same size, and each row is centred on the card: a row
    // holding the pair has its centre between the two dials, not on either.
    const sizes = [lights, amp, aircon, heater].map((dial) => dial.size);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    const lines = new Map<number, number[]>();
    for (const dial of [lights, amp, aircon, heater]) {
      const y = Math.round(dial.y / 4) * 4;
      lines.set(y, [...(lines.get(y) ?? []), dial.x]);
    }
    for (const [y, xs] of lines) {
      const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
      expect(Math.abs(mean - rowCentre), `the row at y=${y} is centred`).toBeLessThanOrEqual(2);
    }

    // The pair shares the first row while both fit; a phone too narrow for two
    // dials gives each its own row rather than letting them overlap.
    if (Math.abs(lights.y - amp.y) <= 2) {
      expect(amp.left - lights.right, "the pair does not overlap").toBeGreaterThanOrEqual(0);
    } else {
      expect(amp.y, "a stacked pair is one dial a row").toBeGreaterThan(lights.y);
    }

    // The climate dials keep the rows below the pair, in order.
    expect(aircon.y).toBeGreaterThan(Math.max(lights.y, amp.y));
    expect(heater.y).toBeGreaterThanOrEqual(aircon.y);

    await expectRingsOnScreen(page, phone.width);

    // The pair's dials carry no rings at all, which is why they take half the
    // row rather than a slot sized for the widest knob's ring reach: tapping one
    // opens no floating ring layer that could run off the screen (2026-09-22
    // independent review).
    for (const segment of [".quick-segment-lights", ".quick-segment-appletv"]) {
      const dial = page.locator(`${segment} .rotary-encoder-dial`);
      const lit = await dial.getAttribute("data-led");
      await tap(dial);
      // The tap landed — neither dial tucks itself away, so its lights cycle —
      // so "no ring layer" is a reading, not a missed press.
      await expect(dial).not.toHaveAttribute("data-led", lit ?? "");
      await expect(page.locator(".rotary-encoder-ring-layer")).toHaveCount(0);
    }

    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.locator(".quick-access").screenshot({ path: path.join(SHOTS, `quick-access-portrait-${phone.name}.png`) });
    }
  });
}

test("wide portrait: the card is the 2x2 with the readings line under it", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await gotoDashboard(page);
  await page.locator(".quick-access-row").scrollIntoViewIfNeeded();
  await expect(dials(page)).toHaveCount(4);
  const [lights, amp, aircon, heater] = await places(page);

  // Two columns, because this width holds two ring-safe slots: the lights and the
  // amplifier share the first row, the two climate knobs the second, and the
  // readings tile is the wide line under them (Adeline, 2026-09-25 — the four
  // dials are the grid, "strictly for dial controls").
  expect(Math.abs(lights.y - amp.y), "the pair shares the first row").toBeLessThanOrEqual(2);
  expect(aircon.y - lights.y, "the climate knobs open the second").toBeGreaterThan(0);
  expect(Math.abs(aircon.y - heater.y), "and share it").toBeLessThanOrEqual(2);
  expect(Math.abs(aircon.x - lights.x), "in the lights' own column").toBeLessThanOrEqual(2);
  expect(Math.abs(heater.x - amp.x), "and the second in the amplifier's").toBeLessThanOrEqual(2);
  const line = await page.locator(".quick-access-row > .panel-slot-wide").boundingBox();
  const row = await page.locator(".quick-access-row").boundingBox();
  if (!line || !row) throw new Error("no line slot");
  expect(line.y, "the readings line sits under both dial rows").toBeGreaterThan(aircon.y);
  expect(line.width, "and is the card's whole width").toBeCloseTo(row.width, 0);
  expect(line.height, "as ONE line").toBeLessThanOrEqual(58);
  // The slots are one size, so every dial is drawn at one size.
  for (const dial of [lights, amp, aircon, heater]) expect(dial.size).toBeCloseTo(lights.size, 0);

  await expectRingsOnScreen(page, 1080);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator(".quick-access").screenshot({ path: path.join(SHOTS, "quick-access-portrait-wide.png") });
  }
});
