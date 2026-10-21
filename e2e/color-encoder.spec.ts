import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoDashboard, watchConsole } from "./helpers";
import { box, expectGeometry, setSize, shot, turnDial } from "./color-encoder.fixtures";

// Geometry and theming of the rotary colour control on the zone panel,
// measured in a real browser against specs/color-encoder.md. The config page's
// dials are in color-encoder.config.spec.ts.

test.describe("colour encoder", () => {
  test("zone dial: geometry at 50, 120 and 200px, every channel", async ({ page }) => {
    const console = watchConsole(page);
    await gotoDashboard(page);
    const dial = page.locator(".zone-panel").getByLabel("Zone lights");
    const root = page.locator(".zone-panel .zone-color-encoder .light-encoder");
    await expect(dial).toBeVisible();
    await dial.scrollIntoViewIfNeeded();

    await expectGeometry(root, 200);
    await expect(root.locator(".rotary-encoder-led")).toHaveCount(3);

    // Lighting opens on brightness, so the cycle starts there.
    for (const channel of ["brightness", "hue", "saturation"]) {
      await expect(dial).toHaveAttribute("data-led", channel);
      await expect(root.locator('.rotary-encoder-led[data-lit="true"]')).toHaveCount(1);
      await expect(root.locator('.rotary-encoder-led[data-lit="true"]')).toHaveAttribute("data-channel", channel);
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
    const root = page.locator(".zone-panel .zone-color-encoder .light-encoder");
    const dial = page.locator(".zone-panel").getByLabel("Zone lights");
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

    const knobImage = async () => root.locator(".rotary-encoder-knob").evaluate((node) => getComputedStyle(node).backgroundImage);
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
    const grip = (dialBox.width / 2) * 0.7;
    await page.mouse.move(dialBox.x + dialBox.width / 2, dialBox.y + dialBox.height / 2 - grip);
    await page.mouse.down();
    await page.mouse.move(dialBox.x + dialBox.width / 2 + grip, dialBox.y + dialBox.height / 2, { steps: 3 });
    expect(await knobImage()).toBe(atRest);
    await shot(root, "zone-pressed");
    await page.mouse.up();

    // The lit light is white, not the highlight colour: at 50px a tinted 3px
    // light does not read (specs/color-encoder.md, "Theming").
    const lit = await root.locator('.rotary-encoder-led[data-lit="true"]').evaluate((node) => getComputedStyle(node).backgroundImage);
    expect(lit).toContain("rgb(255, 255, 255)");
    expect(lit).not.toContain(colours.highlight);
    const litGlow = await root.locator('.rotary-encoder-led[data-lit="true"]').evaluate((node) => getComputedStyle(node).boxShadow);
    expect(litGlow).toContain("rgba(255, 255, 255");
  });

  test("dragging turns the rotor, and the rotor only", async ({ page }) => {
    await gotoDashboard(page);
    const root = page.locator(".zone-panel .zone-color-encoder .light-encoder");
    const dial = page.locator(".zone-panel").getByLabel("Zone lights");
    await dial.scrollIntoViewIfNeeded();
    const transform = (selector: string) => root.locator(selector).evaluate((node) => getComputedStyle(node).transform);
    const knobBefore = await transform(".rotary-encoder-knob");
    const ledsBefore = await transform(".rotary-encoder-leds");
    const rotorBefore = await transform(".rotary-encoder-rotor");

    await turnDial(page, dial, 45);

    expect(await transform(".rotary-encoder-rotor")).not.toBe(rotorBefore);
    expect(await transform(".rotary-encoder-knob")).toBe(knobBefore);
    expect(await transform(".rotary-encoder-leds")).toBe(ledsBefore);
    await shot(root, "zone-rotated");
  });
});
