// Dial locators and ring checks shared by the portrait Quick Access e2e specs
// (quick-access-portrait.spec.ts and quick-access-portrait.presets.spec.ts). It
// is deliberately not a `*.spec.ts` file: Playwright collects those by glob, and
// a helper must not be collected as a spec of its own.
import { expect, type Locator, type Page } from "@playwright/test";

export function dials(page: Page) {
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

export async function tap(target: Locator) {
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

export async function places(page: Page) {
  await settleCard(page);
  return dials(page).evaluateAll((nodes) => nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, size: box.width, left: box.left, right: box.right };
  }));
}

/** Untuck each climate knob in turn and check its ring layer stays on screen. */
export async function expectRingsOnScreen(page: Page, width: number) {
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
