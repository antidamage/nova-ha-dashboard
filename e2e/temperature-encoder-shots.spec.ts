import { expect, test, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Screenshots of the temperature knob for the visual review in
// specs/temperature-encoder.md ("Done means"), plus a numeric sample of the
// colour ring so the scale is checked by value rather than by eye. Off by
// default, as the colour encoder's shot specs are:
//
//   TEMPERATURE_SHOTS=.tmp/knob-shots ./run-e2e.ps1 e2e/temperature-encoder-shots.spec.ts
//
// The knob is scrolled to the middle of a small viewport and the whole viewport
// is captured: the rings live in a body-level fixed layer, so a clip computed
// from the knob's own box cut them off and produced frames that showed nothing.

const SHOTS = process.env.TEMPERATURE_SHOTS;

test.skip(!SHOTS, "set TEMPERATURE_SHOTS=<dir> to capture the review screenshots");

const DEMO = "/temperature-encoder/";

function knob(page: Page, id: string) {
  return page.locator(`[data-demo-knob="${id}"] .rotary-encoder`).first();
}

/**
 * Show one knob and hide its neighbours, then put it in the middle of the
 * viewport. Without this the knobs in a row share a frame, and every shot of
 * that row is the same picture under a different name.
 */
async function centre(page: Page, id: string) {
  await page.evaluate((only) => {
    const style = document.getElementById("shot-isolation") ?? document.createElement("style");
    style.id = "shot-isolation";
    // Hide the neighbours, and centre the subject in its row: the rings reach
    // well outside the knob's own box, and a knob sitting at the row's left
    // edge had them running off the side of the frame.
    style.textContent = `
      [data-demo-knob]:not([data-demo-knob="${only}"]) { visibility: hidden; position: absolute; pointer-events: none; }
      [data-demo-knob="${only}"] { margin-inline: auto; }
      section > div { justify-content: center; }
    `;
    document.head.appendChild(style);
  }, id);
  await page.locator(`[data-demo-knob="${id}"]`).evaluate((node) =>
    node.scrollIntoView({ block: "center", inline: "center" }));
  await page.waitForTimeout(150);
}

/** One deliberate tap: press, hold inside the 60–400ms window, release. */
async function tap(page: Page, id: string) {
  const dial = page.locator(`[data-demo-knob="${id}"] .rotary-encoder-dial`);
  const box = await dial.boundingBox();
  if (!box) throw new Error(`no knob ${id}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
}

async function shot(page: Page, name: string) {
  const dir = SHOTS as string;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

test.use({ viewport: { width: 900, height: 760 } });

test("knob states for the visual review", async ({ page }) => {
  await page.goto(DEMO, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-demo-knob="aircon-200"]')).toBeVisible();
  // Nothing may sit over the bench: no first-run modal, no avatar orb.
  await expect(page.locator(".modal-overlay")).toHaveCount(0);

  // Locked, at each size and on the heater.
  for (const id of ["aircon-200", "aircon-150", "aircon-100", "heater-200", "heater-100"]) {
    await centre(page, id);
    await expect(knob(page, id)).toHaveAttribute("data-locked", "true");
    await shot(page, `locked-${id}`);
  }

  // Across the colour scale, and with no room reading.
  for (const id of ["cold", "mid", "hot", "no-room"]) {
    await centre(page, id);
    await shot(page, `scale-${id}`);
  }

  // Unlocked: all four rings. The state is asserted before the shutter, so a
  // tap that failed to land can never be photographed as if it had.
  await centre(page, "aircon-200");
  await tap(page, "aircon-200");
  await expect(knob(page, "aircon-200")).toHaveAttribute("data-locked", "false");
  await expect(page.locator(".rotary-encoder-ring-layer [data-ring-id]")).toHaveCount(4);
  await page.waitForTimeout(1100);
  await shot(page, "unlocked-aircon-200");

  // Mid-collapse, then tucked away. The click lands on the page heading, well
  // clear of every knob.
  await page.locator("h1").click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(250);
  await shot(page, "collapsing-aircon-200");
  await expect(knob(page, "aircon-200")).toHaveAttribute("data-locked", "true");
  await page.waitForTimeout(1200);
  await shot(page, "relocked-aircon-200");

  // The heater's single ring, open.
  await centre(page, "heater-200");
  await tap(page, "heater-200");
  await expect(knob(page, "heater-200")).toHaveAttribute("data-locked", "false");
  await expect(page.locator(".rotary-encoder-ring-layer [data-ring-id]")).toHaveCount(1);
  await page.waitForTimeout(1100);
  await shot(page, "unlocked-heater-200");

  // The light theme. The demo's pale section is a panel on a dark page, and the
  // rings float over the page rather than the panel — which left light-mode
  // etched labels drawn on black. A light theme paints the whole page, so the
  // shot paints the whole page too.
  await page.addStyleTag({
    content: ':root { --background: #eceef1; } body { background: #dfe2e6; color: #1b1e23; }',
  });
  await centre(page, "aircon-200");
  await expect(knob(page, "aircon-200")).toHaveAttribute("data-locked", "true");
  await shot(page, "light-locked");
  await tap(page, "aircon-200");
  await expect(knob(page, "aircon-200")).toHaveAttribute("data-locked", "false");
  await page.waitForTimeout(1100);
  await shot(page, "light-unlocked");
});

test("the colour ring is the scale's colour, sampled rather than eyeballed", async ({ page }) => {
  await page.goto(DEMO, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-demo-knob="cold"]')).toBeVisible();

  // The ring's paint, read back from the element rather than judged from a
  // screenshot where the glow bloom colours everything around it.
  const paint = async (id: string) =>
    knob(page, id).locator(".rotary-encoder-ring").evaluate((node) => getComputedStyle(node).backgroundImage);

  // 18°C and below is the ice blue; 26°C and above the orange-red; 22°C the
  // pale warm white. The demo's "cold" knob targets 18 with a room of 16.
  expect(await paint("cold")).toContain("rgb(138, 216, 255)");
  expect(await paint("mid")).toContain("rgb(246, 239, 228)");
  expect(await paint("hot")).toContain("rgb(255, 74, 28)");
  // No reading: the bottom half is the charcoal, and the top is still the target.
  const missing = await paint("no-room");
  expect(missing).toContain("rgb(30, 32, 36)");
  // 23°C is a quarter of the way from the pale middle to the orange-red end,
  // so it must still read pale — this is the value the review could not judge
  // by eye against the ring's own bloom.
  expect(missing).toContain("rgb(248, 198, 178)");
});
