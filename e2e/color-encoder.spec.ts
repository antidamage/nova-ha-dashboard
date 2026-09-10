import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoConsoleErrors, gotoConfig, gotoDashboard, watchConsole } from "./helpers";

// Geometry and theming of the rotary colour control, measured in a real
// browser against specs/color-encoder.md. Setting COLOR_ENCODER_SHOTS to a
// directory also writes the screenshots the visual gauntlet reviews.
const SHOTS = process.env.COLOR_ENCODER_SHOTS;

async function shot(target: Locator | Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const measured = await locator.boundingBox();
  if (!measured) throw new Error("element has no box");
  return measured;
}

/** Measures one dial against the spec's geometry table. */
async function expectGeometry(root: Locator, size: number) {
  const tolerance = Math.max(1.5, size * 0.01);
  const dial = await box(root.locator(".color-encoder-dial"));
  expect(Math.abs(dial.width - size * 1.244)).toBeLessThanOrEqual(tolerance);

  const ring = await box(root.locator(".color-encoder-ring"));
  const knob = await box(root.locator(".color-encoder-knob"));
  expect(Math.abs(knob.width - size)).toBeLessThanOrEqual(tolerance);
  // Ring cross-section is 10% of the knob.
  expect(Math.abs((ring.width - knob.width) / 2 - size * 0.1)).toBeLessThanOrEqual(tolerance);

  const leds = root.locator(".color-encoder-led");
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

async function setSize(root: Locator, size: number) {
  await root.evaluate((element, px) => {
    (element as HTMLElement).style.setProperty("--ce-size", `${px}px`);
  }, size);
}

test.describe("colour encoder", () => {
  test("zone dial: geometry at 50, 120 and 200px, every channel", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);
    const dial = page.locator(".zone-panel").getByLabel("Zone colour");
    const root = page.locator(".zone-panel .zone-color-encoder .color-encoder");
    await expect(dial).toBeVisible();
    await dial.scrollIntoViewIfNeeded();

    await expectGeometry(root, 200);
    await expect(root.locator(".color-encoder-led")).toHaveCount(3);

    // Lighting opens on brightness, so the cycle starts there.
    for (const channel of ["brightness", "saturation", "hue"]) {
      await expect(dial).toHaveAttribute("data-channel", channel);
      await expect(root.locator('.color-encoder-led[data-lit="true"]')).toHaveCount(1);
      await expect(root.locator('.color-encoder-led[data-lit="true"]')).toHaveAttribute("data-channel", channel);
      await shot(root, `zone-200-${channel}`);
      await dial.click();
    }

    for (const size of [50, 120]) {
      await setSize(root, size);
      await expectGeometry(root, size);
      await shot(root, `zone-${size}`);
    }
    await setSize(root, 200);
    expectNoConsoleErrors(console);
  });

  test("the knob and lights never take the accent or highlight; the lit light is white", async ({ page }) => {
    await gotoDashboard(page);
    const root = page.locator(".zone-panel .zone-color-encoder .color-encoder");
    const dial = page.locator(".zone-panel").getByLabel("Zone colour");
    await dial.scrollIntoViewIfNeeded();

    const colours = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.appendChild(probe);
      const resolve = (name: string) => {
        probe.style.color = `var(${name})`;
        return getComputedStyle(probe).color;
      };
      const out = { accent: resolve("--cyber-line"), highlight: resolve("--cyber-highlight"), background: resolve("--background") };
      probe.remove();
      return out;
    });

    const knobImage = async () => root.locator(".color-encoder-knob").evaluate((node) => getComputedStyle(node).backgroundImage);
    const atRest = await knobImage();
    expect(atRest).toContain(colours.background);
    expect(atRest).not.toContain(colours.accent);
    expect(atRest).not.toContain(colours.highlight);

    // Hover and press are achromatic: the knob's colours do not change.
    await dial.hover();
    await page.waitForTimeout(600);
    expect(await knobImage()).toBe(atRest);
    await shot(root, "zone-hover");

    const dialBox = await box(dial);
    await page.mouse.move(dialBox.x + dialBox.width / 2, dialBox.y + dialBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dialBox.x + dialBox.width / 2 + 30, dialBox.y + dialBox.height / 2, { steps: 3 });
    expect(await knobImage()).toBe(atRest);
    await shot(root, "zone-pressed");
    await page.mouse.up();

    // The lit light is white, not the highlight colour: at 50px a tinted 3px
    // light does not read (specs/color-encoder.md, "Theming").
    const lit = await root.locator('.color-encoder-led[data-lit="true"]').evaluate((node) => getComputedStyle(node).backgroundImage);
    expect(lit).toContain("rgb(255, 255, 255)");
    expect(lit).not.toContain(colours.highlight);
    const litGlow = await root.locator('.color-encoder-led[data-lit="true"]').evaluate((node) => getComputedStyle(node).boxShadow);
    expect(litGlow).toContain("rgba(255, 255, 255");
  });

  test("dragging turns the rotor, and the rotor only", async ({ page }) => {
    await gotoDashboard(page);
    const root = page.locator(".zone-panel .zone-color-encoder .color-encoder");
    const dial = page.locator(".zone-panel").getByLabel("Zone colour");
    await dial.scrollIntoViewIfNeeded();
    const transform = (selector: string) => root.locator(selector).evaluate((node) => getComputedStyle(node).transform);
    const knobBefore = await transform(".color-encoder-knob");
    const ledsBefore = await transform(".color-encoder-leds");
    const rotorBefore = await transform(".color-encoder-rotor");

    const dialBox = await box(dial);
    const x = dialBox.x + dialBox.width / 2;
    const y = dialBox.y + dialBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 90, y, { steps: 9 });
    await page.mouse.up();

    expect(await transform(".color-encoder-rotor")).not.toBe(rotorBefore);
    expect(await transform(".color-encoder-knob")).toBe(knobBefore);
    expect(await transform(".color-encoder-leds")).toBe(ledsBefore);
    await shot(root, "zone-rotated");
  });

  test("config dial: inline, 50px, opacity light where the slot owns one", async ({ page }) => {
    const console = watchConsole(page);
    await gotoConfig(page);
    const category = page.getByRole("button", { name: /Appearance & Dashboard/ });
    const levels = ["Theme & Experience", "Theme Settings", "Theme Colours"].map((name) =>
      page.locator(".config-accordion-trigger", { hasText: name }).first());
    await expect(async () => {
      if (!(await levels[0].isVisible())) await category.click();
      for (const level of levels) {
        await expect(level).toBeVisible({ timeout: 2_000 });
        if ((await level.getAttribute("aria-expanded")) !== "true") await level.click();
      }
      await expect(page.locator(".theme-widget-cell").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // The dials are on the page itself: no swatch card, and no modal to open.
    await expect(page.locator(".theme-display-card")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const accent = page.locator(".theme-widget-cell", { hasText: "ACCENT" }).first().locator(".color-encoder");
    await accent.scrollIntoViewIfNeeded();
    await expectGeometry(accent, 50);
    await expect(accent.locator(".color-encoder-led")).toHaveCount(3);
    // Label and channel caption are the only text: no value, no hex.
    expect((await accent.textContent())?.trim()).toBe("AccentHUE");
    await shot(accent, "config-accent-50");

    // Border owns its opacity, so its dial has the fourth light.
    const border = page.locator(".theme-widget-cell", { hasText: "BORDERS" }).first().locator(".color-encoder");
    await border.scrollIntoViewIfNeeded();
    await expect(border.locator(".color-encoder-led")).toHaveCount(4);
    await expectGeometry(border, 50);
    await expect(page.getByLabel(/borders opacity/i)).toHaveCount(0);

    // Take opacity to 40% and check the checkerboard shows through.
    const dial = border.locator(".color-encoder-dial");
    for (let index = 0; index < 3; index += 1) await dial.click();
    await expect(dial).toHaveAttribute("data-channel", "opacity");
    const before = Number(await dial.getAttribute("aria-valuenow"));
    const dialBox = await box(dial);
    await page.mouse.move(dialBox.x + dialBox.width / 2, dialBox.y + dialBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(dialBox.x + dialBox.width / 2 + (40 - before) * 3, dialBox.y + dialBox.height / 2, { steps: 20 });
    await page.mouse.up();
    await expect.poll(async () => Number(await dial.getAttribute("aria-valuenow"))).toBe(40);
    const ringColour = await border.locator(".color-encoder-ring").evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(ringColour).toMatch(/rgba\(.*, 0\.\d+\)/);
    await shot(border, "config-border-50-opacity");
    await shot(page.locator(".theme-widget-flow").first(), "config-colour-grid");
    await setSize(border, 200);
    await shot(border, "config-border-at-200-opacity");
    expectNoConsoleErrors(console);
  });
});
