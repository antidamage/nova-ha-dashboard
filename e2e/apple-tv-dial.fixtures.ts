import { expect, type Locator, type Page } from "@playwright/test";
import { opened, pull, settled, toBoundary } from "./advanced-fold.fixtures";
import { selectZone } from "./helpers";

/**
 * Locators and gestures for the amplifier dial, its preset row and the playlist
 * editor in the Lounge panel's Advanced section — shared by
 * `apple-tv-dial.spec.ts` (the dial and its presets) and
 * `apple-tv-playlists.spec.ts` (the editor), so the two specs each stay a
 * readable size (specs/agent-token-footprint.md).
 */

/** The Quick Access segment the amplifier dial lives in. */
export function quickAmp(page: Page) {
  return page.locator(".quick-access .quick-segment-appletv");
}

/** The dial itself, inside that segment. */
export function ampDial(page: Page) {
  return quickAmp(page).locator(".rotary-encoder-dial");
}

/**
 * The Lounge's own zone panel. More than one panel is mounted at once in
 * landscape (the selected zone's and the climate zone's), so every Lounge
 * lookup is scoped to the panel whose heading names it.
 */
export function loungePanel(page: Page) {
  return page.locator(".zone-panel")
    .filter({ has: page.locator(".zone-panel-title", { hasText: /^Lounge$/i }) })
    .first();
}

/**
 * Open the Lounge's zone panel.
 *
 * The demo's zones arrive with the first state poll, so the button is not in
 * the DOM when the dashboard's shell is: wait for it, then let `selectZone`
 * open whichever accordion group holds it. The panel's own heading is the gate
 * — the previous zone's panel is still on screen until the click takes.
 */
export async function openLounge(page: Page) {
  await expect(page.locator(".zones-panel").getByRole("button", { name: /^Lounge$/i }).first())
    .toBeAttached({ timeout: 30_000 });
  await selectZone(page, /^Lounge$/i);
  await expect(loungePanel(page).locator(".zone-dial-pair")).toHaveCount(1, { timeout: 30_000 });
}

/**
 * A press on a control that answers to a pointer down and up, not a click.
 *
 * The press point is the original 65% of the control's height — on this dial
 * that is the knob's own body, not the row of mode lights across its centre, so
 * the press cannot land in a gap between two lights. The hold is a tenth of a
 * second: a gesture is only a tap while it has lasted under 400 ms
 * (`sliderTapGesture.ts`), and a loaded box stretches the wall-clock between
 * the down and the up.
 */
export async function tap(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to tap");
  await target.page().mouse.move(box.x + box.width / 2, box.y + box.height * 0.65);
  await target.page().mouse.down();
  await target.page().waitForTimeout(100);
  await target.page().mouse.up();
}

/**
 * Pull the Lounge panel's Advanced fold open and hand back the playlist editor
 * inside it, scrolled into the column's view.
 *
 * The repo's own fold gestures (`advanced-fold.fixtures.ts`): a 200px drag from
 * the divider is what the fold's own specs open it with, and it does not depend
 * on how many wheel notches land inside the band's 400 ms window — a bare burst
 * of notches is consumed reaching the boundary first, which is how this helper
 * fooled me into "the editor was never mounted". Advanced is a scrolling column
 * whose content is taller than the band, so the editor also has to be brought
 * into view before anything in it can be pressed.
 */
export async function openAdvanced(page: Page) {
  const fold = loungePanel(page).locator(".advanced-fold").first();
  const editor = loungePanel(page).locator(".apple-tv-playlists");
  await settled(fold);
  await toBoundary(page, fold);
  await pull(page, fold, 200);
  await opened(fold);
  await expect(editor).toBeVisible();
  await editor.scrollIntoViewIfNeeded();
  return editor;
}
