import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoConsoleErrors, seedExperienceMode, watchConsole } from "./helpers";

// RingedColorEncoder on its demo page, measured in a real browser against
// specs/color-encoder-rings.md. Setting COLOR_ENCODER_SHOTS to a directory
// also writes the screenshots the visual gauntlet reviews.
const SHOTS = process.env.COLOR_ENCODER_SHOTS;

async function shot(target: Locator | Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
}

async function openDemo(page: Page) {
  // Without a stored choice the first-run experience-mode dialog covers the page.
  await seedExperienceMode(page);
  await page.goto("/color-encoder-rings/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-demo-dial="count-5"] .ringed-encoder-rings')).toBeVisible({ timeout: 30_000 });
}

function dial(page: Page, id: string) {
  return page.locator(`[data-demo-dial="${id}"] .ringed-encoder`);
}

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const measured = await locator.boundingBox();
  if (!measured) throw new Error("element has no box");
  return measured;
}

/** The spec's geometry table, recomputed here so the test does not trust the code. */
function expected(size: number, rings: number) {
  const font = Math.min(14, Math.max(10, size * 0.075));
  const pitch = Math.max(size * 0.085, font + 2);
  const track = (pitch * 6) / 8.5;
  const gap = pitch - track;
  const dialRadius = size * 0.622;
  const radii = Array.from({ length: rings }, (_, index) => dialRadius + gap + track / 2 + index * pitch);
  return { font, pitch, track, radii, dialRadius };
}

test.describe("RingedColorEncoder demo", () => {
  test("draws 0–5 rings with the dial dead centre and the label above the lights", async ({ page }) => {
    const console = watchConsole(page);
    await openDemo(page);
    for (const rings of [0, 1, 2, 3, 4, 5]) {
      const root = dial(page, `count-${rings}`);
      await expect(root.locator(".ringed-encoder-ring-slider")).toHaveCount(rings);
      const whole = await box(root);
      const knob = await box(root.locator(".ringed-encoder-knob"));
      expect(Math.abs(knob.width - 200)).toBeLessThanOrEqual(2);
      expect(Math.abs(whole.x + whole.width / 2 - (knob.x + knob.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(whole.y + whole.height / 2 - (knob.y + knob.height / 2))).toBeLessThanOrEqual(1);

      const label = await box(root.locator(".ringed-encoder-label"));
      const leds = await box(root.locator(".ringed-encoder-leds"));
      const caption = await box(root.locator(".ringed-encoder-channel"));
      // Mirrors the caption: as far above the lights as the caption is below.
      const above = leds.y - (label.y + label.height);
      const below = caption.y - (leds.y + leds.height);
      expect(Math.abs(above - below)).toBeLessThanOrEqual(1.5);
      expect(label.y).toBeGreaterThan(knob.y);
      // Same font as the caption.
      const sizes = await root.evaluate((element) => {
        const read = (selector: string) => getComputedStyle(element.querySelector(selector)!).fontSize;
        return [read(".ringed-encoder-label"), read(".ringed-encoder-channel")];
      });
      expect(sizes[0]).toBe(sizes[1]);
      await shot(root, `count-${rings}`);
    }
    expectNoConsoleErrors(console);
  });

  for (const size of [200, 100, 56]) {
    test(`ring geometry and labels at ${size}px`, async ({ page }) => {
      await openDemo(page);
      const root = dial(page, `size-${size}`);
      const geometry = expected(size, 5);
      const measured = await root.evaluate((element) => {
        const svg = element.querySelector("svg.ringed-encoder-rings") as SVGSVGElement;
        const box = svg.getBoundingClientRect();
        const cy = box.top + box.height / 2;
        const wells = Array.from(svg.querySelectorAll<SVGPathElement>(".ringed-encoder-well")).map((well) => ({
          width: Number(well.getAttribute("stroke-width")),
          // A path's box is its geometry without the stroke, so the top of each
          // arc sits its centreline radius above the centre.
          top: cy - well.getBoundingClientRect().top,
        }));
        // Each glyph's centre, as a radius and a clockwise-from-12 angle about
        // the dial centre, in the SVG's own units.
        const centre = svg.viewBox.baseVal.width / 2;
        const labels = Array.from(svg.querySelectorAll<SVGTextElement>(".ringed-encoder-etch-face")).map((text) => {
          const glyphs = [];
          for (let index = 0; index < text.getNumberOfChars(); index += 1) {
            const extent = text.getExtentOfChar(index);
            const x = extent.x + extent.width / 2 - centre;
            const y = extent.y + extent.height / 2 - centre;
            glyphs.push({ radius: Math.hypot(x, y), angle: (Math.atan2(x, -y) * 180) / Math.PI });
          }
          return { text: text.textContent ?? "", glyphs, font: parseFloat(getComputedStyle(text).fontSize) };
        });
        return { wells, labels };
      });
      expect(measured.wells).toHaveLength(5);
      measured.wells.forEach((well, index) => {
        expect(Math.abs(well.width - geometry.track)).toBeLessThanOrEqual(0.05);
        expect(Math.abs(well.top - geometry.radii[index])).toBeLessThanOrEqual(1.5);
      });
      // Every glyph is centred on its own ring and inside the bottom gap, and
      // the rings are further apart than a glyph is tall, so no two labels can
      // touch. Glyph centres sit off the path by half the ascent-descent box,
      // so allow a little of the font size radially.
      expect(geometry.pitch - geometry.font).toBeGreaterThanOrEqual(2 - 1e-9);
      measured.labels.forEach((label, index) => {
        expect(label.font).toBeCloseTo(geometry.font, 1);
        expect(label.glyphs.length).toBeGreaterThan(0);
        for (const glyph of label.glyphs) {
          expect(Math.abs(glyph.radius - geometry.radii[index])).toBeLessThanOrEqual(geometry.font * 0.2 + 0.5);
          expect(Math.abs(glyph.angle)).toBeGreaterThan(135);
        }
      });
      await shot(root, `size-${size}`);
    });
  }

  test("dragging a thumb round the arc moves only that ring, and pins in the gap", async ({ page }) => {
    await openDemo(page);
    const root = dial(page, "count-3");
    const svg = root.locator("svg.ringed-encoder-rings");
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
    // On into the gap and out the far side: pinned at the top, no jump.
    for (const angle of [150, 180, 210, 240]) await page.mouse.move(...point(angle));
    expect(Number(await outer.getAttribute("aria-valuenow"))).toBe(100);
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
      Array.from(element.querySelectorAll<HTMLElement>(".ringed-encoder-led")).map((led) => ({
        lit: led.dataset.lit === "true",
        image: getComputedStyle(led).backgroundImage,
      })));
    expect(fills.filter((led) => led.lit)).toHaveLength(1);
    for (const led of fills) expect(led.image.startsWith('url("data:image/png')).toBe(led.lit);

    // A disabled control dims each ring once, to 45%, not 45% of 45%.
    const opacity = await dial(page, "disabled").evaluate((element) => {
      const ring = element.querySelector(".ringed-encoder-ring-slider") as Element;
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
