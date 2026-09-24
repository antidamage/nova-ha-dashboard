import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoDashboard } from "./helpers";

// specs/quick-access-card.md, portrait (Adeline, 2026-09-14, revised
// 2026-09-25): the card is a GRID of slots, one per module placed on it, and
// every slot is the same width. Portrait's grid is the card's balanced one
// wherever a slot can still hold a knob's rings — three columns on a wide
// screen, two on a tablet, one on a phone — and the rings of a knob that is
// untucked stay on screen either way. Below one slot's width every dial shrinks
// together, floor 100px.
// QUICK_ACCESS_SHOTS=<dir> keeps a screenshot of the card at each viewport.

const SHOTS = process.env.QUICK_ACCESS_SHOTS;

const PHONES = [
  { name: "iphone-pro-max", width: 440, height: 956 },
  { name: "iphone", width: 375, height: 812 },
  { name: "narrow", width: 300, height: 640 },
];

function dials(page: Page) {
  return page.locator(
    ".quick-access .quick-segment-lights .rotary-encoder-dial,"
    + " .quick-access .quick-segment-appletv .rotary-encoder-dial,"
    + " .quick-access .quick-climate .rotary-encoder-dial",
  );
}

/**
 * Wait until the card's own measured layout has stopped moving. The slots and
 * the dial sizes are derived from the card's width a frame or two after the
 * controls arrive, so a measurement — or a press — taken on the first frame the
 * dials exist can land on a dial that is still moving, which turns a tap into a
 * missed press.
 */
async function settleCard(page: Page) {
  await page.waitForFunction(() => {
    const dial = document.querySelector(".quick-access .rotary-encoder-dial");
    if (!dial) return false;
    const box = dial.getBoundingClientRect();
    const key = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
    const holder = window as unknown as { __novaQuickDial?: string };
    const same = holder.__novaQuickDial === key;
    holder.__novaQuickDial = key;
    return same;
  });
}

/**
 * One deliberate tap, the gesture that untucks a temperature knob.
 *
 * A tucked knob opens only on a press the page measures as lasting between
 * UNLOCK_MIN_MS and TAP_MAX_MS (60-400ms, controls/rotary/constants.ts): a
 * brush or a held press deliberately does not. A renderer busy with a loaded
 * suite can deliver the press and the release back to back and measure under a
 * millisecond, so 250ms is held — comfortably inside the window — and
 * {@link openRings} taps again rather than reading a mis-measured press as the
 * knob refusing to open.
 */
const TAP_HOLD_MS = 250;

async function tap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await settleCard(target.page());
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to tap");
  await target.page().mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
  await target.page().mouse.down();
  await target.page().waitForTimeout(TAP_HOLD_MS);
  await target.page().mouse.up();
}

/** Tap a tucked knob until its ring layer is up; throws if it never opens. */
async function openRings(page: Page, target: Locator, what: string) {
  const layer = page.locator(".rotary-encoder-ring-layer");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tap(target);
    try {
      // The layer mounts a frame after the unlock, so wait for it rather than
      // counting it on the frame the press ended.
      await layer.waitFor({ state: "attached", timeout: 1500 });
      return layer;
    } catch {
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`${what}: the ring layer never opened after three taps`);
}

async function places(page: Page) {
  await settleCard(page);
  return dials(page).evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, size: box.width, left: box.left, right: box.right };
  }));
}

/** Untuck each climate knob in turn and check its ring layer stays on screen. */
async function expectRingsOnScreen(page: Page, width: number) {
  const knobs = page.locator(".quick-access .quick-climate .rotary-encoder-dial");
  const count = await knobs.count();
  expect(count).toBe(2);
  for (let index = 0; index < count; index += 1) {
    const layer = await openRings(page, knobs.nth(index), `knob ${index}`);
    // Let the layer pin itself to the dial's rect on the next frame.
    await page.waitForTimeout(100);
    const box = await layer.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    expect(box.left, `knob ${index}: rings past the left edge`).toBeGreaterThanOrEqual(0);
    expect(box.right, `knob ${index}: rings past the right edge`).toBeLessThanOrEqual(width);
    // Tap outside to tuck it again before the next knob.
    await page.mouse.click(2, 2);
    await expect(layer).toHaveCount(0);
  }
}

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

test("portrait: each dial's preset row hugs it", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await gotoDashboard(page);
  await expect(dials(page)).toHaveCount(4);
  const measured = await page.evaluate(() => [...document.querySelectorAll(".quick-access .quick-button-pair")].map((pair) => {
    const segment = pair.closest(".quick-segment");
    const dialRoot = segment?.querySelector(".rotary-encoder-dial") ?? null;
    const row = pair.getBoundingClientRect();
    const dial = dialRoot?.getBoundingClientRect() ?? null;
    return {
      segment: segment?.className.replace("quick-segment ", "") ?? "",
      gap: dial ? Math.round(row.top - dial.bottom) : null,
      buttons: pair.querySelectorAll("button").length,
    };
  }));
  expect(measured.map((entry) => entry.segment).sort()).toEqual(["quick-segment-appletv", "quick-segment-lights"]);
  for (const entry of measured) {
    expect(entry.buttons, `${entry.segment}: one button per preset`).toBe(3);
    // Was 23px of dial-box slack plus the gap before 2026-09-22.
    expect(entry.gap, `${entry.segment}: preset row below the dial`).toBeLessThanOrEqual(12);
    expect(entry.gap, `${entry.segment}: preset row not over the dial`).toBeGreaterThanOrEqual(0);
  }
});

test("portrait: a full playlist list wraps its own slot without moving the dial", async ({ page }) => {
  // 300px wide: a slot is one line's whole width there, and six 44px playlist
  // buttons do not fit one slot, so the row wraps to a second line.
  await page.setViewportSize({ width: 300, height: 640 });
  // The demo store is where a deviceless dashboard keeps the amplifier's state
  // (appleTVAmpClient). Six is the most the list may hold.
  await page.addInitScript((playlists) => {
    window.sessionStorage.setItem("nova.dashboard.demoAppleTVAmp.v1", JSON.stringify({ playlists }));
  }, ["Excellent", "Sword Smoke & Temple Drums", "Cool", "Four", "Five", "Six"]);
  await gotoDashboard(page);
  await expect(dials(page)).toHaveCount(4);
  const ampRow = page.locator(".quick-segment-appletv .quick-button-pair");
  await expect(ampRow.getByRole("button")).toHaveCount(6);
  const lightsRow = page.locator(".quick-segment-lights .quick-button-pair");
  await expect(lightsRow.getByRole("button"), "the lights keep their three presets").toHaveCount(3);
  const [ampRowBox, lightsRowBox] = await Promise.all([ampRow.boundingBox(), lightsRow.boundingBox()]);
  // The lights' three 44px buttons stay on one line, so the comparison has a
  // floor: it fails if either row collapses.
  expect(lightsRowBox!.height, "the lights' row is one button line").toBeLessThanOrEqual(48);
  expect(ampRowBox!.height, "six playlists wrap to a second line").toBeGreaterThan(lightsRowBox!.height * 1.5);

  // Both dials start at the top of their own slot: the extra playlist line
  // grows the amplifier's slot downwards rather than moving its dial
  // (Adeline, 2026-09-23 — content aligns to the top of its space).
  const tops = await page.evaluate(() => [".quick-segment-lights", ".quick-segment-appletv"].map((selector) => {
    const segment = document.querySelector(`.quick-access ${selector}`);
    const dial = segment?.querySelector(".rotary-encoder-dial");
    if (!segment || !dial) throw new Error(`no dial in ${selector}`);
    return Math.round(dial.getBoundingClientRect().top - segment.getBoundingClientRect().top);
  }));
  expect(Math.abs(tops[0] - tops[1]), "both dials sit at the top of their slot").toBeLessThanOrEqual(2);

  const [lights, amp] = await places(page);
  // A phone gives each slot the whole line, so the amplifier's slot is the one
  // below the lights'.
  expect(amp.y, "the amplifier takes the slot below").toBeGreaterThan(lights.y);
  expect(lights.size).toBeCloseTo(amp.size, 0);
});

test("portrait narrow phone: dials shrink to fit, not below 100px", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 640 });
  await gotoDashboard(page);
  await expect(dials(page)).toHaveCount(4);
  const sizes = await page.locator(".quick-access .rotary-encoder:not(.rotary-encoder-ring-layer)").evaluateAll((nodes) =>
    nodes.map((node) => parseFloat(getComputedStyle(node).getPropertyValue("--re-size"))));
  expect(sizes.length).toBe(4);
  for (const size of sizes) {
    expect(size).toBeLessThan(133);
    expect(size).toBeGreaterThanOrEqual(100);
  }
});

test("wide portrait: the card is one grid, three slots to a row", async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await gotoDashboard(page);
  await page.locator(".quick-access-row").scrollIntoViewIfNeeded();
  await expect(dials(page)).toHaveCount(4);
  const [lights, amp, aircon, heater] = await places(page);

  // Five modules, three columns: the light dial, the amplifier dial and the first
  // climate knob share the first row, and the second climate knob opens the
  // second, in the column under the light dial (Adeline, 2026-09-25 — the grid,
  // not the old dial-line/climate/readings lines).
  expect(Math.abs(lights.y - amp.y), "the pair shares the first row").toBeLessThanOrEqual(2);
  expect(Math.abs(aircon.y - lights.y), "the first climate knob is on that row too").toBeLessThanOrEqual(2);
  expect(heater.y - lights.y, "the second row is the one below").toBeGreaterThan(0);
  expect(Math.abs(heater.x - lights.x), "and its column is the light dial's").toBeLessThanOrEqual(2);
  // The slots are one size, so every dial is drawn at one size.
  for (const dial of [lights, amp, aircon, heater]) expect(dial.size).toBeCloseTo(lights.size, 0);

  await expectRingsOnScreen(page, 1080);

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.locator(".quick-access").screenshot({ path: path.join(SHOTS, "quick-access-portrait-wide.png") });
  }
});
