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
    expect(await stepId(page)).toBe("lights");
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

  test("how was this control built? opens the layer stack and goes back to the same step", async ({ page }) => {
    await openTour(page);
    await page.locator(".tutorial-button-next").click();
    expect(await stepId(page)).toBe("lights");
    await page.locator(".tutorial-layers-button").click();
    const stage = page.locator(".layer-stage");
    await expect(stage).toBeVisible();
    await expect.poll(() => page.locator(".layer-list-item").count(), { timeout: 15_000 }).toBeGreaterThan(5);
    await page.locator(".layer-list-item").first().click();
    await expect(page.locator(".layer-note-text")).not.toHaveText(/Tap a layer/);
    await page.keyboard.press("Escape");
    await expect(stage).toHaveCount(0);
    await expect(page.locator(".tutorial-layer")).toBeVisible();
    expect(await stepId(page)).toBe("lights");
  });

  test("Pause freezes the finger and Resume carries on", async ({ page }) => {
    await openTour(page);
    await page.locator(".tutorial-button-next").click();
    const button = page.locator(".tutorial-playback-button");
    await expect(button).toHaveText("Pause");
    await page.waitForTimeout(1500);
    await button.click();
    await expect(button).toHaveText("Resume");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const dial = page.locator("[data-tutorial-copy='light'] .rotary-encoder-dial");
    await page.waitForTimeout(800);
    const held = await dial.getAttribute("aria-valuenow");
    await page.waitForTimeout(1200);
    expect(await dial.getAttribute("aria-valuenow")).toBe(held);
    await button.click();
    await expect(button).toHaveText("Pause");
    await expect.poll(() => dial.getAttribute("aria-valuenow"), { timeout: 15_000 }).not.toBe(held);
  });

  test("a long pause on the orb step starts the play again from a fresh copy", async ({ page }) => {
    await openTour(page);
    for (let step = 0; step < 20; step += 1) {
      if ((await stepId(page)) === "orb") break;
      await page.locator(".tutorial-button-next").click();
    }
    if ((await stepId(page)) !== "orb") test.skip(true, "no status orb on this layout");
    const host = page.locator(".tutorial-orb-host");
    await expect.poll(() => host.getAttribute("data-orb-dial"), { timeout: 20_000 }).toBe("open");
    await page.locator(".tutorial-playback-button").click();
    // Longer than the dial's 5s idle close: the copy moves on without the script.
    await page.waitForTimeout(6000);
    await page.locator(".tutorial-playback-button").click();
    await expect(page.locator(".tutorial-playback-button")).toHaveText("Pause");
    // The play restarts: the dial opens and walks the entries again, wash included.
    const seen = new Set<string>();
    for (let tick = 0; tick < 80 && seen.size < 3; tick += 1) {
      if ((await host.getAttribute("data-orb-dial")) === "open") seen.add((await host.getAttribute("data-orb-entry")) ?? "");
      await page.waitForTimeout(250);
    }
    expect([...seen].sort()).toEqual(["bins", "timer", "wash"]);
  });

  test("the fold step drags the fold open and back closed on its own", async ({ page }) => {
    await openTour(page);
    for (let step = 0; step < 20; step += 1) {
      if ((await stepId(page)) === "advanced") break;
      await page.locator(".tutorial-button-next").click();
    }
    if ((await stepId(page)) !== "advanced") test.skip(true, "no closed fold on this layout");
    await expect.poll(() => page.locator(".advanced-fold[data-open='true']").count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".advanced-fold[data-open='true']").count(), { timeout: 20_000 }).toBe(0);
  });

  test("the theme step walks the four modes unmasked, stores nothing, and gives the page back", async ({ page }) => {
    await openTour(page);
    const stored = () => page.evaluate(() => window.localStorage.getItem("nova.dashboard.themeOverride.v1"));
    const before = await stored();
    for (let step = 0; step < 20; step += 1) {
      if ((await stepId(page)) === "theme") break;
      await page.locator(".tutorial-button-next").click();
    }
    expect(await stepId(page)).toBe("theme");
    await expect(page.locator(".tutorial-layer")).toHaveAttribute("data-lifted", "true");
    await expect(page.locator(".tutorial-target-ring")).toBeVisible();
    const mode = page.locator(".dashboard-theme-override-link");
    const seen = new Set<string>();
    for (let tick = 0; tick < 40 && seen.size < 4; tick += 1) {
      seen.add((await mode.getAttribute("data-theme-override")) ?? "");
      await page.waitForTimeout(500);
    }
    expect([...seen].sort()).toEqual(["auto", "dark", "light", "unset"]);
    const variants = await page.evaluate(() => document.documentElement.dataset.themeVariant);
    expect(variants).toBeTruthy();
    expect(await stored()).toBe(before);
    await page.locator(".tutorial-bar .tutorial-button").first().click();
    await expect(mode).toHaveAttribute("data-theme-override", before ?? "unset");
    expect(await stored()).toBe(before);
  });

  test("the aircon layer view shows Manual with every ring", async ({ page }) => {
    await openTour(page);
    for (let step = 0; step < 20; step += 1) {
      if ((await stepId(page)) === "aircon") break;
      await page.locator(".tutorial-button-next").click();
    }
    if ((await stepId(page)) !== "aircon") test.skip(true, "no aircon on this layout");
    await page.locator(".tutorial-layers-button").click();
    await expect(page.locator(".layer-note-lead")).toHaveText("Shown in Manual so every ring draws.");
    for (const ring of ["mode", "fan", "fresh", "timer"]) {
      await expect(page.locator(`.rotary-encoder-ring-layer[data-portal-tag='tutorial'] [data-ring-id='${ring}']`)).toHaveCount(1);
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".tutorial-playback-button")).toHaveText("Replay");
  });
});
