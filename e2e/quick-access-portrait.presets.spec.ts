import { expect, test } from "@playwright/test";
import { gotoDashboard } from "./helpers";
import { dials, places } from "./quick-access-portrait.fixtures";

// specs/quick-access-card.md, portrait: each dial's preset row hugs it, a full
// playlist list wraps inside its own slot, and on a narrow phone the dials
// shrink together to a 100px floor. The grid itself is in
// quick-access-portrait.spec.ts.

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
