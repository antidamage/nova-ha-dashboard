// Shared helpers for the ColorEncoder demo-page e2e specs
// (color-encoder-rings.spec.ts and color-encoder-rings.drag.spec.ts). It is
// deliberately not a `*.spec.ts` file: Playwright collects those by glob, and a
// helper must not be collected as a spec of its own.
import { expect, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { seedExperienceMode } from "./helpers";

// ColorEncoder on its demo page, measured in a real browser against
// specs/color-encoder.md. Setting COLOR_ENCODER_SHOTS to a directory
// also writes the screenshots the visual gauntlet reviews.
const SHOTS = process.env.COLOR_ENCODER_SHOTS;

export async function shot(target: Locator | Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

export async function openDemo(page: Page) {
  // Without a stored choice the first-run experience-mode dialog covers the page.
  await seedExperienceMode(page);
  await page.goto("/color-encoder-rings/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-demo-dial="count-5"] .rotary-encoder-rings')).toBeVisible({ timeout: 30_000 });
}

export function dial(page: Page, id: string) {
  return page.locator(`[data-demo-dial="${id}"] .color-encoder`);
}

export type Box = { x: number; y: number; width: number; height: number };

export async function box(locator: Locator): Promise<Box> {
  const measured = await locator.boundingBox();
  if (!measured) throw new Error("element has no box");
  return measured;
}

/**
 * The spec's geometry table, recomputed here so the test does not trust the code.
 *
 * `ColorEncoder` hands its `label` to the dial as a **title**, and a titled
 * dial's rings sit a title band further out: the caption's font plus 2% of the
 * size of clearance at each side (`titleBand` in
 * `controls/rotary/geometry-model.ts`). Without the band these three tests and
 * the drag below read the wrong radius and are red on main — named here as the
 * fix by Adeline, 2026-09-20, with the note that it was not the unlock ring's
 * doing. The band takes the *caption*; a dial with four or more rings shrinks
 * only its label font, to the pitch less 6, so the labels do not crowd
 * (Adeline, 2026-09-12).
 */
export function expected(size: number, rings: number) {
  const font = Math.min(14, Math.max(10, size * 0.075));
  const pitch = Math.max(size * 0.085, font + 2);
  const track = (pitch * 6) / 8.5;
  const gap = pitch - track;
  // DIAL_RADIUS_SHARE: half the knob, plus the unlock ring, ring and bevel.
  const dialRadius = size * 0.657;
  // TITLE_CLEARANCE_SHARE, once each side of the caption.
  const titleBand = font + 2 * size * 0.02;
  const labelFont = rings >= 4 ? Math.min(font, Math.max(10, pitch - 6)) : font;
  const radii = Array.from({ length: rings }, (_, index) => dialRadius + titleBand + gap + track / 2 + index * pitch);
  return { font, labelFont, pitch, track, radii, dialRadius, titleBand };
}
