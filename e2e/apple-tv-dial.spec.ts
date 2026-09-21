import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PLAYLISTS } from "../lib/apple-tv/playlists";
import { gotoDashboard, selectZone } from "./helpers";

// specs/apple-tv-volume.md: the amplifier dial — the IR emitter's placeholder
// (Adeline, 2026-09-22). It turns the volume, cycling its two lights toggles
// mute, its ring is blue-green, and its preset buttons are the Apple TV's
// playlists. The Lounge panel mounts the same dial beside its lighting dial,
// and the playlist list lives in that panel's Advanced section, under House
// Party. Nothing is sent anywhere yet: the amplifier has no endpoint.

function quickAmp(page: Page) {
  return page.locator(".quick-access .quick-segment-appletv");
}

function ampDial(page: Page) {
  return quickAmp(page).locator(".rotary-encoder-dial");
}

/**
 * Open the Lounge's zone panel.
 *
 * The demo's zones arrive with the first state poll, so the button is not in
 * the DOM when the dashboard's shell is: wait for it, then let `selectZone`
 * open whichever accordion group holds it. The panel's own heading is the gate
 * — the previous zone's panel is still on screen until the click takes.
 */
async function openLounge(page: Page) {
  await expect(page.locator(".zones-panel").getByRole("button", { name: /^Lounge$/i }).first())
    .toBeAttached({ timeout: 30_000 });
  await selectZone(page, /^Lounge$/i);
  await expect(loungePanel(page).locator(".zone-dial-pair")).toHaveCount(1, { timeout: 30_000 });
}

/**
 * The Lounge's own zone panel. More than one panel is mounted at once in
 * landscape (the selected zone's and the climate zone's), so every Lounge
 * lookup is scoped to the panel whose heading names it.
 */
function loungePanel(page: Page) {
  return page.locator(".zone-panel")
    .filter({ has: page.locator(".zone-panel-title", { hasText: /^Lounge$/i }) })
    .first();
}

async function tap(target: ReturnType<Page["locator"]>) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to tap");
  await target.page().mouse.move(box.x + box.width / 2, box.y + box.height * 0.65);
  await target.page().mouse.down();
  await target.page().waitForTimeout(140);
  await target.page().mouse.up();
}

test("Quick Access carries an Apple TV dial: blue-green, reading the volume", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  const segment = quickAmp(page);
  await expect(segment).toBeVisible();
  await expect(segment.locator(".rotary-encoder-title")).toHaveText("Apple TV");
  await expect(segment.locator(".apple-tv-encoder-level")).toHaveText("40%");
  await expect(segment.locator(".apple-tv-encoder-mode")).toHaveText("VOLUME");

  // The ring is the blue-green gradient, not a flat colour.
  const paint = await segment.locator(".apple-tv-encoder").evaluate((node) => (node as HTMLElement).style.getPropertyValue("--re-ring-paint"));
  expect(paint).toContain("conic-gradient(from 0deg");
  expect(paint).toContain("#1fc9a6");
  expect(paint).toContain("#6ef0cf");
  await expect(segment.locator(".rotary-encoder-led[data-lit='true']").first()).toHaveAttribute("data-channel", "volume");
});

test("cycling the dial's modes toggles mute, and the volume turns", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  const segment = quickAmp(page);
  const dial = ampDial(page);

  await tap(dial);
  await expect(segment.locator(".apple-tv-encoder-mode")).toHaveText("MUTED");
  await expect(segment.locator(".rotary-encoder-led[data-lit='true']").first()).toHaveAttribute("data-channel", "mute");
  await expect(dial).toHaveAttribute("aria-valuetext", /muted$/);

  await tap(dial);
  await expect(segment.locator(".apple-tv-encoder-mode")).toHaveText("VOLUME");

  // A quarter turn clockwise, from the knob's own centre.
  const box = await dial.boundingBox();
  if (!box) throw new Error("no dial box");
  const radius = box.width * 0.3;
  const at = (degrees: number) => ({
    x: box.x + box.width / 2 + Math.sin((degrees * Math.PI) / 180) * radius,
    y: box.y + box.height / 2 - Math.cos((degrees * Math.PI) / 180) * radius,
  });
  await page.mouse.move(at(0).x, at(0).y);
  await page.mouse.down();
  await page.mouse.move(at(60).x, at(60).y, { steps: 8 });
  await page.mouse.move(at(90).x, at(90).y, { steps: 8 });
  await page.mouse.up();
  await expect(segment.locator(".apple-tv-encoder-level")).not.toHaveText("40%");
});

test("its preset buttons are the Apple TV's playlists, marked as they are chosen", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  const presets = quickAmp(page).locator(".apple-tv-presets");
  await expect(presets.getByRole("button")).toHaveCount(3);
  for (const name of DEFAULT_PLAYLISTS) {
    await expect(presets.getByRole("button", { name: `Play ${name} on the Apple TV` })).toBeVisible();
  }

  const second = presets.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[1]} on the Apple TV` });
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(presets.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[0]} on the Apple TV` })).toHaveAttribute("aria-pressed", "false");
});

test("the dial and its presets send nothing: the amplifier has no endpoint yet", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/appletv") && request.method() !== "GET") writes.push(`${request.method()} ${request.url()}`);
  });
  await gotoDashboard(page);
  await tap(ampDial(page));
  await quickAmp(page).locator(".apple-tv-presets button").first().click();
  await page.waitForTimeout(400);
  expect(writes).toEqual([]);
});

test("the Lounge panel mounts the same dial beside its lighting dial", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await openLounge(page);
  const pair = loungePanel(page).locator(".zone-dial-pair");
  const measured = await pair.evaluate((node) => {
    const dial = (selector: string) => {
      const box = node.querySelector(selector)?.querySelector(".rotary-encoder-dial")?.getBoundingClientRect();
      return box ? { size: Math.round(box.width), y: Math.round(box.top + box.height / 2), x: Math.round(box.left + box.width / 2) } : null;
    };
    return { lighting: dial(".zone-color-encoder"), amp: dial(".zone-amplifier-controls") };
  });
  expect(measured.lighting).not.toBeNull();
  expect(measured.amp).not.toBeNull();
  // The same size, on the same centre line.
  expect(measured.amp!.size).toBe(measured.lighting!.size);
  expect(Math.abs(measured.amp!.y - measured.lighting!.y)).toBeLessThanOrEqual(2);
  // Halved: the panel's own dial is 200px.
  expect(measured.lighting!.size).toBeLessThanOrEqual(140);

  // Each with its own preset row underneath: four lighting presets and the
  // three playlists.
  await expect(pair.locator(".zone-lighting-presets:not(.apple-tv-presets) button")).toHaveCount(4);
  await expect(pair.locator(".apple-tv-presets button")).toHaveCount(3);
});

test("the Lounge's Advanced section lists the playlists, under House Party", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await openLounge(page);

  // Pull the fold open: a landscape fold takes four quarter-weighted notches.
  const fold = loungePanel(page).locator(".advanced-fold").first();
  const box = await fold.boundingBox();
  if (!box) throw new Error("no fold box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let notch = 0; notch < 8; notch += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
  }

  const editor = loungePanel(page).locator(".apple-tv-playlists");
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: "Apple TV playlists" })).toBeVisible();
  const rows = editor.locator(".apple-tv-playlist-input");
  await expect(rows).toHaveCount(3);
  for (const [index, name] of DEFAULT_PLAYLISTS.entries()) {
    await expect(rows.nth(index)).toHaveValue(name);
  }
  // House Party owns the row above it, and the editor sits beneath it.
  const party = loungePanel(page).locator(".zone-party-control");
  const [partyBox, editorBox] = await Promise.all([party.boundingBox(), editor.boundingBox()]);
  expect(editorBox!.y).toBeGreaterThan(partyBox!.y);

  // A new playlist joins the dial's preset row as well: one list, two mounts.
  await editor.getByRole("button", { name: "Add playlist" }).click();
  await expect(editor.locator(".apple-tv-playlist-input")).toHaveCount(4);
  await expect(loungePanel(page).locator(".zone-amplifier-controls .apple-tv-presets button")).toHaveCount(4);
});
