import { expect, test } from "@playwright/test";
import { DEFAULT_PLAYLISTS } from "../lib/apple-tv/playlists";
import { ampDial, loungePanel, openLounge, quickAmp, tap } from "./apple-tv-dial.fixtures";
import { gotoDashboard } from "./helpers";

// specs/apple-tv-volume.md: the amplifier dial — the IR emitter's placeholder
// (Adeline, 2026-09-22). It turns the volume, cycling its two lights toggles
// mute, its ring is blue-green, and its preset buttons are the Apple TV's
// playlists. The Lounge panel mounts the same dial beside its lighting dial,
// and the playlist list itself is edited in that panel's Advanced section —
// which apple-tv-playlists.spec.ts covers. Nothing is sent anywhere yet: the
// amplifier has no endpoint.
//
// Opening the Lounge panel settles a heavy layout before anything can be read
// or pressed, so the ceiling is the repo's 120 s for a surface spec rather than
// the config's 45 s (advanced-fold, lighting-rules, reminders-editor).
test.describe.configure({ timeout: 120_000 });

test("Quick Access carries an Apple TV dial: blue-green, reading the volume", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  const segment = quickAmp(page);
  await expect(segment).toBeVisible();
  await expect(segment.locator(".rotary-encoder-title")).toHaveText("Apple TV");
  await expect(segment.locator(".apple-tv-encoder-level")).toHaveText("40%");
  await expect(segment.locator(".apple-tv-encoder-mode")).toHaveText("VOLUME");

  // The ring is the blue-green gradient, top to bottom like every other dial's,
  // and never an angular sweep.
  const paint = await segment.locator(".apple-tv-encoder").evaluate((node) => (node as HTMLElement).style.getPropertyValue("--re-ring-paint"));
  expect(paint).toContain("linear-gradient(180deg");
  expect(paint).not.toContain("conic-gradient");
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

test("its preset buttons are the Apple TV's playlists, and a press lights nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  const presets = quickAmp(page).locator(".apple-tv-presets");
  await expect(presets.getByRole("button")).toHaveCount(3);
  for (const name of DEFAULT_PLAYLISTS) {
    await expect(presets.getByRole("button", { name: `Play ${name} on the Apple TV` })).toBeVisible();
  }

  // One shot (Adeline, 2026-09-22): the press fires the preset's play event and
  // stays dark — a lit button would read as "this is what is playing".
  await presets.getByRole("button", { name: `Play ${DEFAULT_PLAYLISTS[1]} on the Apple TV` }).click();
  await page.waitForTimeout(200);
  await expect(presets.locator("button[aria-pressed='true']")).toHaveCount(0);
  await expect(presets.locator("button.quick-button-active")).toHaveCount(0);
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
