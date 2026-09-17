import { expect, test } from "@playwright/test";
import {
  REMINDERS,
  atRest,
  expectSameRect,
  geometry,
  openZone,
  opened,
  pull,
  settled,
  toBoundary,
} from "./advanced-fold.fixtures";

// The dashboard renders at a handful of frames a second in headless Chromium
// under three workers, and every mouse step waits for a frame: the default 45s
// is not enough for a test that loads, settles and drags.
test.describe.configure({ timeout: 120_000 });

test.describe("advanced fold, landscape 1366x768: Reminders", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test("the Reminders fold has a definite height and opens with the drag band", async ({ page }) => {
    await openZone(page, /Reminders/);
    const fold = page.locator(REMINDERS);
    await expect(fold).toHaveCount(1);
    const header = await page.locator(".tasks-stage .tasks-panel > header").boundingBox();
    const panel = await page.locator(".tasks-stage .tasks-panel").boundingBox();
    await toBoundary(page, fold);
    const closed = await geometry(fold);
    // It fills the column below the panel's header, not merely its content.
    expect(closed.rect.height, "fold height").toBeGreaterThan(200);
    expect(closed.rect.top).toBeGreaterThan(header!.y + header!.height - 1);
    expect(closed.divider.top + closed.divider.height).toBeLessThanOrEqual(closed.rect.top + closed.rect.height + 0.5);
    expect(closed.rect.top + closed.rect.height).toBeLessThanOrEqual(panel!.y + panel!.height + 0.5);

    await pull(page, fold, 120, false);
    const held = await geometry(fold);
    expect(held.open).toBe("false");
    expect(Math.abs(held.shift)).toBeGreaterThan(5);
    await page.mouse.up();
    await atRest(fold);
    expect((await geometry(fold)).open).toBe("false");

    await pull(page, fold, 180);
    await opened(fold);
    const open = await geometry(fold);
    expectSameRect(open.rect, closed.rect, "Reminders sub-panel");
    expectSameRect({ left: 0, top: 0, ...open.defaultSize }, { left: 0, top: 0, ...closed.defaultSize }, "Reminders default area");
  });

  test("a fold sized by its content does not ratchet its default area taller", async ({ page }) => {
    await openZone(page, /Reminders/);
    const fold = page.locator(REMINDERS);
    // Take the definite height away, so the fold's size comes from its content.
    await fold.evaluate((el) => {
      (el.parentElement as HTMLElement).style.display = "block";
      el.style.height = "auto";
      el.style.flex = "none";
    });
    await settled(fold);
    const defaultHeight = () => fold.evaluate((el) =>
      (el.querySelector(":scope > .advanced-fold-track > .advanced-fold-default") as HTMLElement).offsetHeight);
    const original = await defaultHeight();

    await fold.evaluate((el) => {
      const filler = document.createElement("div");
      filler.dataset.testFiller = "true";
      filler.style.cssText = "height:900px;flex:none";
      el.querySelector(".advanced-fold-default")!.appendChild(filler);
    });
    await expect.poll(defaultHeight).toBeGreaterThanOrEqual(900);
    await fold.evaluate((el) => el.querySelector("[data-test-filler]")!.remove());
    await expect.poll(async () => Math.abs((await defaultHeight()) - original)).toBeLessThanOrEqual(1);
    await settled(fold);
    expect(Math.abs((await defaultHeight()) - original)).toBeLessThanOrEqual(1);
  });
});
