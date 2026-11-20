import { expect, test, type Page } from "@playwright/test";
import { gotoDashboard, neutralizeTaskAlerts, seedExperienceMode, waitForStableLayout } from "./helpers";

// The "?" tour (specs/tutorial-mode.md). Runs against the demo build, so the
// guard is the demo's scroll-friendly one; the strict guard's decisions are
// covered by app/components/tutorial/inputGuard.test.ts.

async function openTour(page: Page) {
  await seedExperienceMode(page);
  await gotoDashboard(page);
  await waitForStableLayout(page);
  await neutralizeTaskAlerts(page);
  await page.locator(".tutorial-help-button").click();
  await expect(page.locator(".tutorial-layer")).toBeVisible();
}

const stepId = (page: Page) => page.locator(".tutorial-layer").getAttribute("data-tutorial-step");

/** Every request that is not a read: what a command would be. */
function watchWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    // Next's dev overlay posts its own stack frames; that is tooling, not the page.
    if (request.url().includes("/__nextjs")) return;
    if (request.method() !== "GET" && request.method() !== "HEAD") writes.push(`${request.method()} ${request.url()}`);
  });
  return writes;
}

test.describe("tutorial mode", () => {
  test("opens from the ?, steps with Next and Back, and closes with Esc and the close box", async ({ page }) => {
    await openTour(page);
    const count = page.locator(".tutorial-count");
    await expect(count).toHaveText(/^1 \/ \d+$/);
    await page.locator(".tutorial-button-next").click();
    await expect(count).toHaveText(/^2 \/ /);
    await page.locator(".tutorial-bar .tutorial-button").first().click();
    await expect(count).toHaveText(/^1 \/ /);

    await page.locator(".tutorial-panel").focus();
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText(/^2 \/ /);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tutorial-layer")).toHaveCount(0);
    await expect(page.locator(".tutorial-help-button")).toBeFocused();

    await page.locator(".tutorial-help-button").click();
    await page.locator(".tutorial-close").click();
    await expect(page.locator(".tutorial-layer")).toHaveCount(0);
  });

  test("plays on a copy over the real knob, which is hidden while covered", async ({ page }) => {
    await openTour(page);
    await page.locator(".tutorial-button-next").click();
    expect(await stepId(page)).toBe("tap-vs-turn");
    const copy = page.locator("[data-tutorial-copy='light']");
    await expect(copy).toBeVisible();
    await expect(copy.locator(".tutorial-copy-tag")).toHaveText("DEMO");
    await expect(page.locator(".zone-color-encoder[data-tutorial-covered='true']")).toHaveCount(1);
    // The finger turns the copy: its value moves on its own.
    const dial = copy.locator(".rotary-encoder-dial");
    const before = await dial.getAttribute("aria-valuenow");
    await expect.poll(() => dial.getAttribute("aria-valuenow"), { timeout: 15_000 }).not.toBe(before);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-tutorial-covered]")).toHaveCount(0);
  });

  test("nothing under the mask can be pressed, and no command is sent", async ({ page }) => {
    const writes = watchWrites(page);
    await openTour(page);
    const realDial = page.locator(".rotary-encoder.temperature-encoder .rotary-encoder-dial").first();
    const realValue = await realDial.getAttribute("aria-valuenow");
    const box = await realDial.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2, { steps: 8 });
      await page.mouse.up();
    }
    const preset = page.locator(".zone-lighting-presets button").first();
    if (await preset.count()) {
      const presetBox = await preset.boundingBox();
      if (presetBox) await page.mouse.click(presetBox.x + presetBox.width / 2, presetBox.y + presetBox.height / 2);
    }
    expect(await realDial.getAttribute("aria-valuenow")).toBe(realValue);
    await expect(page.locator(".tutorial-layer")).toBeVisible();
    // Walk the whole tour while watching for writes.
    for (let step = 0; step < 20; step += 1) {
      if (!(await page.locator(".tutorial-layer").count())) break;
      await page.waitForTimeout(1200);
      await page.locator(".tutorial-button-next").click();
    }
    expect(writes).toEqual([]);
  });

  test("the page still scrolls under the mask", async ({ page }) => {
    // Portrait phone: the page is taller than the screen, so a wheel has
    // somewhere to go.
    await page.setViewportSize({ width: 390, height: 844 });
    await openTour(page);
    const total = () => page.evaluate(() => {
      let sum = window.scrollX + window.scrollY;
      for (const element of Array.from(document.querySelectorAll<HTMLElement>("*"))) sum += element.scrollTop + element.scrollLeft;
      return sum;
    });
    const before = await total();
    await page.mouse.move(195, 640);
    await page.mouse.wheel(0, 600);
    await expect.poll(total, { timeout: 5_000 }).not.toBe(before);
  });

  test("the fold step opens a closed fold and the tour closes it again", async ({ page }) => {
    await openTour(page);
    for (let step = 0; step < 20; step += 1) {
      if ((await stepId(page)) === "advanced") break;
      await page.locator(".tutorial-button-next").click();
    }
    if ((await stepId(page)) !== "advanced") test.skip(true, "no closed fold on this layout");
    await expect.poll(() => page.locator(".advanced-fold[data-open='true']").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator(".advanced-fold[data-open='true']").count(), { timeout: 10_000 }).toBe(0);
  });
});
