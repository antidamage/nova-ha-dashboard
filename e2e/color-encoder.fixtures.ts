// Shared measuring and turning helpers for the colour encoder e2e specs
// (color-encoder.spec.ts and color-encoder.config.spec.ts). It is deliberately
// not a `*.spec.ts` file: Playwright collects those by glob, and a helper must
// not be collected as a spec of its own.
import { expect, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";

// Setting COLOR_ENCODER_SHOTS to a directory also writes the screenshots the
// visual gauntlet reviews.
const SHOTS = process.env.COLOR_ENCODER_SHOTS;

export async function shot(target: Locator | Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

export type Box = { x: number; y: number; width: number; height: number };

export async function box(locator: Locator): Promise<Box> {
  const measured = await locator.boundingBox();
  if (!measured) throw new Error("element has no box");
  return measured;
}

/** Measures one dial against the spec's geometry table. */
export async function expectGeometry(root: Locator, size: number) {
  const tolerance = Math.max(1.5, size * 0.01);
  const dial = await box(root.locator(".rotary-encoder-dial"));
  // DIAL_OUTER_RATIO: half the knob, the unlock ring, the colour ring, the bevel.
  expect(Math.abs(dial.width - size * 1.314)).toBeLessThanOrEqual(tolerance);

  const ring = await box(root.locator(".rotary-encoder-ring"));
  const unlock = await box(root.locator(".rotary-encoder-unlock-ring"));
  const knob = await box(root.locator(".rotary-encoder-knob"));
  expect(Math.abs(knob.width - size)).toBeLessThanOrEqual(tolerance);
  // Both rings span the whole band between the knob's lip and the rim — the
  // unlock ring's own 3.5% is a mask, not a box — so the two elements are the
  // same size and the pair together are the 3.5% + 10% outside the knob.
  expect(Math.abs((ring.width - knob.width) / 2 - size * 0.135)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(unlock.width - ring.width)).toBeLessThanOrEqual(tolerance);
  // And the mask that makes the band: the knob's edge (78.75% of it) round to
  // the colour ring's inner edge (84.25%).
  const mask = await root.locator(".rotary-encoder-unlock-glass").evaluate((element) => {
    const styles = getComputedStyle(element);
    return styles.maskImage || styles.getPropertyValue("-webkit-mask-image") || "";
  });
  expect(mask).toContain("78.75%");
  expect(mask).toContain("84.25%");

  const leds = root.locator(".rotary-encoder-led");
  const count = await leds.count();
  const boxes: Box[] = [];
  for (let index = 0; index < count; index += 1) boxes.push(await box(leds.nth(index)));
  const width = Math.max(3, size * 0.048);
  for (const led of boxes) {
    expect(Math.abs(led.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(led.height - width * 2)).toBeLessThanOrEqual(1);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    const gap = boxes[index].x - (boxes[index - 1].x + boxes[index - 1].width);
    expect(Math.abs(gap - width * 3)).toBeLessThanOrEqual(1);
  }
  // The light row sits dead centre on the knob.
  const rowCentre = (boxes[0].x + boxes[boxes.length - 1].x + boxes[boxes.length - 1].width) / 2;
  expect(Math.abs(rowCentre - (knob.x + knob.width / 2))).toBeLessThanOrEqual(1);
}

/**
 * Turns a dial by `degrees`: press on the knob, sweep about its centre,
 * release. The knob is relative, so where the press lands does not matter —
 * only the angle swept (specs/color-encoder.md, "Interaction").
 */
export async function turnDial(page: Page, dial: Locator, degrees: number) {
  const measured = await box(dial);
  const cx = measured.x + measured.width / 2;
  const cy = measured.y + measured.height / 2;
  const grip = (measured.width / 2) * 0.7;
  const at = (angle: number): [number, number] => {
    const radians = (angle * Math.PI) / 180;
    return [cx + grip * Math.sin(radians), cy - grip * Math.cos(radians)];
  };
  await page.mouse.move(...at(0));
  await page.mouse.down();
  const steps = Math.max(3, Math.ceil(Math.abs(degrees) / 30));
  for (let step = 1; step <= steps; step += 1) await page.mouse.move(...at((degrees * step) / steps));
  await page.mouse.up();
}

/** Degrees of turn that move a 0–100 channel by `percent`. */
export function degreesFor(percent: number) {
  return percent * 2.7;
}

export async function setSize(root: Locator, size: number) {
  await root.evaluate((element, px) => {
    (element as HTMLElement).style.setProperty("--re-size", `${px}px`);
  }, size);
}
