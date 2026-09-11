import { expect, test, type Locator, type Page } from "@playwright/test";

// The temperature knob in a real browser, against specs/temperature-encoder.md
// and the tuck-away rules in specs/color-encoder.md. It drives the demo page,
// which has no devices behind it: nothing here reaches Home Assistant.

const DEMO = "/temperature-encoder/";

async function open(page: Page) {
  await page.goto(DEMO, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-demo-knob="aircon-200"]')).toBeVisible();
}

function knob(page: Page, id: string) {
  return page.locator(`[data-demo-knob="${id}"] .rotary-encoder`);
}

function dial(page: Page, id: string) {
  return page.locator(`[data-demo-knob="${id}"] .rotary-encoder-dial`);
}

/** One deliberate tap: press, hold inside the 60–400ms window, release. */
async function tap(target: Locator, held = 150) {
  const box = await target.boundingBox();
  if (!box) throw new Error("no box to tap");
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.2;
  await target.page().mouse.move(x, y);
  await target.page().mouse.down();
  await target.page().waitForTimeout(held);
  await target.page().mouse.up();
}

test.describe("temperature knob", () => {
  test("starts tucked away and opens on one tap", async ({ page }) => {
    await open(page);
    const root = knob(page, "aircon-200");
    await expect(root).toHaveAttribute("data-locked", "true");
    // Locked, it still shows both temperatures and its mode lights.
    await expect(root.locator(".temperature-encoder-target")).toHaveText("22°");
    await expect(root.locator(".temperature-encoder-room")).toHaveText("21.4°");
    await expect(root.locator(".rotary-encoder-led")).toHaveCount(3);

    await tap(dial(page, "aircon-200"));
    await expect(root).toHaveAttribute("data-locked", "false");
    await expect(page.locator(".rotary-encoder-ring-layer")).toHaveCount(1);
  });

  test("a brush and a long hold leave it shut", async ({ page }) => {
    await open(page);
    const root = knob(page, "aircon-150");
    const target = dial(page, "aircon-150");
    const box = await target.boundingBox();
    if (!box) throw new Error("no box");

    // A brush across it: the pointer moves, so it is not a tap.
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(root).toHaveAttribute("data-locked", "true");

    await tap(target, 900);
    await expect(root).toHaveAttribute("data-locked", "true");
  });

  test("its rings are the four the aircon needs, in order, and float over the page", async ({ page }) => {
    await open(page);
    await tap(dial(page, "aircon-200"));
    const layer = page.locator(".rotary-encoder-ring-layer");
    await expect(layer).toHaveCount(1);
    const ids = await layer.locator("[data-ring-id]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-ring-id")));
    expect(ids).toEqual(["mode", "fan", "fresh", "timer"]);

    // Over the page, not inside the knob's own box.
    const z = await layer.evaluate((node) => getComputedStyle(node).zIndex);
    expect(Number(z)).toBe(9000);
    await expect(layer.locator('[data-testid="rotary-encoder-blocker"]')).toHaveCount(1);
  });

  test("the timer reads its minutes at the ring's end, and the mode ring carries no value", async ({ page }) => {
    await open(page);
    await tap(dial(page, "aircon-200"));
    const layer = page.locator(".rotary-encoder-ring-layer");
    const timer = layer.locator('[data-ring-id="timer"]');
    await expect(timer.locator(".rotary-encoder-ring-value").first()).toHaveText("38 MIN");
    await expect(layer.locator('[data-ring-id="mode"] .rotary-encoder-ring-value')).toHaveCount(0);
  });

  test("a tap elsewhere tucks it away again", async ({ page }) => {
    await open(page);
    const root = knob(page, "aircon-200");
    await tap(dial(page, "aircon-200"));
    await expect(root).toHaveAttribute("data-locked", "false");

    await page.mouse.click(5, 5);
    await expect(root).toHaveAttribute("data-locked", "true");
  });

  test("it tucks itself away after five quiet seconds", async ({ page }) => {
    await open(page);
    const root = knob(page, "aircon-100");
    await tap(dial(page, "aircon-100"));
    await expect(root).toHaveAttribute("data-locked", "false");
    await expect(root).toHaveAttribute("data-locked", "true", { timeout: 8000 });
  });

  test("the heater's knob has two lights and one ring", async ({ page }) => {
    await open(page);
    const root = knob(page, "heater-200");
    await expect(root.locator(".rotary-encoder-led")).toHaveCount(2);
    await tap(dial(page, "heater-200"));
    const ids = await page.locator(".rotary-encoder-ring-layer [data-ring-id]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-ring-id")));
    expect(ids).toEqual(["timer"]);
  });

  test("the ring paints the target over the room, and goes dark with no reading", async ({ page }) => {
    await open(page);
    const paintOf = (id: string) =>
      knob(page, id).locator(".rotary-encoder-ring").evaluate((node) => getComputedStyle(node).backgroundImage);

    const cold = await paintOf("cold");
    const hot = await paintOf("hot");
    expect(cold).toContain("conic-gradient");
    expect(cold).not.toBe(hot);
    expect(await paintOf("no-room")).toContain("rgb(30, 32, 36)");
  });
});
