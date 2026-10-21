import { expect, test } from "@playwright/test";
import { box, dial, expected, openDemo, shot } from "./color-encoder-rings.fixtures";

// ColorEncoder on its demo page (specs/color-encoder.md): dragging a ring's
// thumb, and the light-mode and disabled treatments. Ring counts and geometry
// are in color-encoder-rings.spec.ts.

test.describe("ColorEncoder demo", () => {
  test("dragging a thumb round the arc moves only that ring, and pins in the gap", async ({ page }) => {
    await openDemo(page);
    const root = dial(page, "count-3");
    // The demo page has grown long enough that this dial sits below the fold,
    // and the pointer is driven in viewport coordinates: without this the press
    // lands on the page behind it and moves nothing (Adeline, 2026-09-21).
    await root.scrollIntoViewIfNeeded();
    const svg = root.locator("svg.rotary-encoder-rings");
    const frame = await box(svg);
    const cx = frame.x + frame.width / 2;
    const cy = frame.y + frame.height / 2;
    const radius = expected(200, 3).radii[2];
    const point = (angle: number) => {
      const radians = (angle * Math.PI) / 180;
      return [cx + radius * Math.sin(radians), cy - radius * Math.cos(radians)] as const;
    };
    const outer = root.locator('[data-ring-index="2"]');
    const inner = root.locator('[data-ring-index="0"]');
    const innerBefore = await inner.getAttribute("aria-valuenow");

    await page.mouse.move(...point(0));
    await page.mouse.down();
    expect(Number(await outer.getAttribute("aria-valuenow"))).toBeCloseTo(50, 0);
    for (let angle = 10; angle <= 120; angle += 10) await page.mouse.move(...point(angle));
    const high = Number(await outer.getAttribute("aria-valuenow"));
    expect(high).toBeGreaterThan(90);
    // On into the gap and out the far side: pinned at the top from the first
    // degree of gap onward, and still pinned at every step through it.
    for (const angle of [150, 180, 210, 240]) {
      await page.mouse.move(...point(angle));
      expect(Number(await outer.getAttribute("aria-valuenow"))).toBe(100);
    }
    await page.mouse.up();
    expect(await inner.getAttribute("aria-valuenow")).toBe(innerBefore);
    await shot(root, "dragged");
  });

  test("light section takes the light treatment", async ({ page }) => {
    await openDemo(page);
    await expect(dial(page, "light-5")).toHaveAttribute("data-mode", "light");
    await expect(dial(page, "count-5")).toHaveAttribute("data-mode", "dark");
    // The lit light keeps its white fill in light mode; unlit ones are dark.
    const fills = await dial(page, "light-5").evaluate((element) =>
      Array.from(element.querySelectorAll<HTMLElement>(".rotary-encoder-led")).map((led) => ({
        lit: led.dataset.lit === "true",
        image: getComputedStyle(led).backgroundImage,
      })));
    expect(fills.filter((led) => led.lit)).toHaveLength(1);
    // The lit light carries the 97-byte PNG that suppresses Chromium's auto dark
    // mode (specs/color-encoder.md, "Surviving Brave's auto dark mode"), and an
    // unlit one does not. It is not the *first* layer of the stack — the themed
    // ramp is layered over it, on top — so this looks for it anywhere in the
    // value rather than at the front.
    for (const led of fills) expect(led.image.includes('url("data:image/png')).toBe(led.lit);
    // And the ramp must stay ON TOP of it: the PNG is only there to keep auto
    // dark mode's hands off the element, so a stack with the raster first would
    // paint the PNG's near-white instead of the light's colour — the failure the
    // layer order exists to prevent (app/styles/controls/rotary-leds.css).
    for (const led of fills.filter((item) => item.lit)) {
      const ramp = led.image.indexOf("linear-gradient");
      expect(ramp).toBeGreaterThanOrEqual(0);
      expect(ramp).toBeLessThan(led.image.indexOf('url("data:image/png'));
    }

    // A disabled control dims each ring once, to 45%, not 45% of 45%.
    const opacity = await dial(page, "disabled").evaluate((element) => {
      const ring = element.querySelector(".rotary-encoder-ring-slider") as Element;
      let total = 1;
      for (let node: Element | null = ring; node && node !== element.parentElement; node = node.parentElement) {
        total *= Number(getComputedStyle(node).opacity);
      }
      return total;
    });
    expect(opacity).toBeCloseTo(0.45, 2);
    await shot(page.locator('[data-demo-dial="light-5"]').locator(".."), "light");
    await shot(page.locator('[data-demo-dial="alpha"]').locator(".."), "states");
  });
});
