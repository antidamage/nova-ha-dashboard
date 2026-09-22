import { expect, test } from "@playwright/test";
import { DEFAULT_PLAYLISTS } from "../lib/apple-tv/playlists";
import { loungePanel, openAdvanced, openLounge, quickAmp } from "./apple-tv-dial.fixtures";
import { gotoDashboard } from "./helpers";

// specs/apple-tv-volume.md: the Apple TV's preset playlists, edited in the
// Lounge panel's Advanced section under House Party (Adeline, 2026-09-22). Each
// preset is a playlist name, the icon its button wears, and the way it plays.
// The dial and its preset row are apple-tv-dial.spec.ts.
//
// The dashboard has to load, settle, then be driven — a fold drag, a picker, a
// save round trip, and the editor scrolled into the Advanced column — and 45 s
// is not enough for that on a loaded box. The repo's other surface specs raise
// the same ceiling (advanced-fold, lighting-rules, reminders-editor).
test.describe.configure({ timeout: 120_000 });

test("the Lounge's Advanced section lists the playlists, under House Party", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await openLounge(page);
  const editor = await openAdvanced(page);

  await expect(editor.getByRole("heading", { name: "Apple TV playlists" })).toBeVisible();
  const rows = editor.locator(".apple-tv-playlist-input");
  await expect(rows).toHaveCount(3);
  for (const [index, name] of DEFAULT_PLAYLISTS.entries()) {
    await expect(rows.nth(index)).toHaveValue(name);
  }
  // Every row carries its own icon button and its own playback pair.
  await expect(editor.locator(".apple-tv-playlist-icon button")).toHaveCount(3);
  await expect(editor.locator(".apple-tv-playlist-mode[data-preset-repeat]")).toHaveCount(3);
  await expect(editor.locator(".apple-tv-playlist-mode[data-preset-shuffle]")).toHaveCount(3);
  // House Party owns the row above it, and the editor sits beneath it.
  const party = loungePanel(page).locator(".zone-party-control");
  const [partyBox, editorBox] = await Promise.all([party.boundingBox(), editor.boundingBox()]);
  expect(editorBox!.y).toBeGreaterThan(partyBox!.y);

  // A new playlist joins the dial's preset row as well: one list, two mounts.
  await editor.getByRole("button", { name: "Add playlist" }).click();
  await expect(editor.locator(".apple-tv-playlist-input")).toHaveCount(4);
  await expect(loungePanel(page).locator(".zone-amplifier-controls .apple-tv-presets button")).toHaveCount(4);
});

test("a preset wears the icon the editor gives it, on both mounts", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await openLounge(page);
  const editor = await openAdvanced(page);
  const row = editor.locator(".apple-tv-playlist-icon").first();
  const panelPreset = loungePanel(page).locator(".zone-amplifier-controls .apple-tv-presets button").first();
  const quickPreset = quickAmp(page).locator(".apple-tv-presets button").first();

  // Nothing chosen: the note the buttons have always worn.
  await expect(row).toHaveAttribute("data-preset-icon", "note");
  // Demo mode renders these in place of a Radix tooltip, and this button must
  // not advertise a lighting preset (review finding).
  await expect(row.getByRole("button")).toHaveAttribute("data-demo-tooltip-title", "Icon");
  await row.getByRole("button").click();
  await expect(page.getByRole("heading", { name: "Icon for Excellent" })).toBeVisible();
  await page.getByRole("button", { name: "Flame" }).click();

  // The row, the panel's preset button and Quick Access all wear it.
  await expect(row).toHaveAttribute("data-preset-icon", "flame");
  await expect(panelPreset).toHaveAttribute("data-preset-icon", "flame");
  await expect(panelPreset.locator("svg")).toHaveAttribute("class", /lucide-flame/);
  await expect(quickPreset.locator("svg")).toHaveAttribute("class", /lucide-flame/);

  // Choosing the note takes it back off, which is the only way an icon is
  // removed.
  await row.getByRole("button").click();
  await page.getByRole("button", { name: "Note" }).click();
  await expect(row).toHaveAttribute("data-preset-icon", "note");
  await expect(quickPreset.locator("svg")).toHaveAttribute("class", /lucide-music/);
});

test("a preset saves the way it plays: the shuffle switch and the repeat button's three", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoDashboard(page);
  await openLounge(page);
  const editor = await openAdvanced(page);
  const panelPreset = loungePanel(page).locator(".zone-amplifier-controls .apple-tv-presets button").first();

  // The shipped preset plays once, in order, and says so by saying nothing.
  await expect(panelPreset).toHaveAttribute("aria-label", "Play Excellent on the Apple TV");
  await expect(editor.locator(".apple-tv-playlist-mode[data-preset-repeat='off']")).toHaveCount(3);

  await editor.getByRole("button", { name: "Repeat Excellent: Play once" }).click();
  await expect(editor.getByRole("button", { name: "Repeat Excellent: Loop" })).toBeVisible();
  await expect(panelPreset).toHaveAttribute("aria-label", "Play Excellent on the Apple TV (looping)");

  await editor.getByRole("button", { name: "Shuffle Excellent" }).click();
  await expect(editor.getByRole("button", { name: "Shuffle Excellent" })).toHaveAttribute("aria-pressed", "true");
  await expect(panelPreset).toHaveAttribute("aria-label", "Play Excellent on the Apple TV (shuffled, looping)");

  await editor.getByRole("button", { name: "Repeat Excellent: Loop" }).click();
  await expect(panelPreset).toHaveAttribute("aria-label", "Play Excellent on the Apple TV (shuffled, endless)");
  await editor.getByRole("button", { name: "Repeat Excellent: Endless" }).click();
  await expect(panelPreset).toHaveAttribute("aria-label", "Play Excellent on the Apple TV (shuffled)");

  // Both are per preset: the rows around it were not touched, and the second
  // mount — Quick Access — carries the same answer.
  await expect(editor.getByRole("button", { name: "Shuffle Cool" })).toHaveAttribute("aria-pressed", "false");
  await expect(editor.getByRole("button", { name: "Repeat Cool: Play once" })).toBeVisible();
  await expect(quickAmp(page).locator(".apple-tv-presets button").first())
    .toHaveAttribute("aria-label", "Play Excellent on the Apple TV (shuffled)");
});
