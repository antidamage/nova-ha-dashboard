import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, watchConsole } from "./helpers";
import { box, dial, expected, openDemo, shot } from "./color-encoder-rings.fixtures";

// ColorEncoder on its demo page, measured in a real browser against
// specs/color-encoder.md: ring counts, title and caption placement, and the
// ring geometry at three sizes. Dragging and the light treatment are in
// color-encoder-rings.drag.spec.ts.

test.describe("ColorEncoder demo", () => {
  test("draws 0–5 rings with the dial dead centre, its name arced over the knob and the caption under the lights", async ({ page }) => {
    const console = watchConsole(page);
    await openDemo(page);
    for (const rings of [0, 1, 2, 3, 4, 5]) {
      const root = dial(page, `count-${rings}`);
      await expect(root.locator(".rotary-encoder-ring-slider")).toHaveCount(rings);
      const whole = await box(root);
      const knob = await box(root.locator(".rotary-encoder-knob"));
      expect(Math.abs(knob.width - 200)).toBeLessThanOrEqual(2);
      expect(Math.abs(whole.x + whole.width / 2 - (knob.x + knob.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(whole.y + whole.height / 2 - (knob.y + knob.height / 2))).toBeLessThanOrEqual(1);

      // The dial's name is its **title arc**, over the knob and outside it
      // (specs/color-encoder.md, "The title arcs over the knob"), and a
      // ColorEncoder dial carries no face-top text. So this measures where the
      // name actually sits — on its own radius, outside the knob's rim — rather
      // than only that it is above the knob: a title parked on the knob face as
      // a plain label would satisfy an ordering alone.
      const name = await box(root.locator(".rotary-encoder-title"));
      const leds = await box(root.locator(".rotary-encoder-leds"));
      const caption = await box(root.locator(".rotary-encoder-channel"));
      expect(name.y + name.height).toBeLessThanOrEqual(knob.y);
      expect(caption.y).toBeGreaterThanOrEqual(leds.y + leds.height);

      const title = await root.evaluate((element) => {
        const svg = element.querySelector<SVGSVGElement>("svg.rotary-encoder-title-arc");
        const text = svg?.querySelector<SVGTextElement>(".rotary-encoder-title");
        if (!svg || !text) return null;
        const centre = svg.viewBox.baseVal.width / 2;
        const glyphs: { radius: number; angle: number }[] = [];
        for (let index = 0; index < text.getNumberOfChars(); index += 1) {
          const extent = text.getExtentOfChar(index);
          const x = extent.x + extent.width / 2 - centre;
          const y = extent.y + extent.height / 2 - centre;
          glyphs.push({ radius: Math.hypot(x, y), angle: (Math.atan2(x, -y) * 180) / Math.PI });
        }
        return { glyphs, font: Number.parseFloat(getComputedStyle(text).fontSize) };
      });
      expect(title).not.toBeNull();
      expect(title!.glyphs.length).toBeGreaterThan(0);
      // TITLE_CLEARANCE_SHARE each side of the caption, over DIAL_RADIUS_SHARE.
      const titleRadius = 200 * 0.657 + 200 * 0.02 + title!.font / 2;
      for (const glyph of title!.glyphs) {
        expect(Math.abs(glyph.radius - titleRadius)).toBeLessThanOrEqual(title!.font * 0.25 + 1);
        expect(glyph.radius).toBeGreaterThan(100);
        expect(Math.abs(glyph.angle)).toBeLessThan(135);
      }

      const sizes = await root.evaluate((element) => {
        const read = (selector: string) => getComputedStyle(element.querySelector(selector)!).fontSize;
        return [read(".rotary-encoder-title"), read(".rotary-encoder-channel")];
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
        const svg = element.querySelector("svg.rotary-encoder-rings") as SVGSVGElement;
        const box = svg.getBoundingClientRect();
        const cy = box.top + box.height / 2;
        const wells = Array.from(svg.querySelectorAll<SVGPathElement>(".rotary-encoder-well")).map((well) => ({
          width: Number(well.getAttribute("stroke-width")),
          // A path's box is its geometry without the stroke, so the top of each
          // arc sits its centreline radius above the centre.
          top: cy - well.getBoundingClientRect().top,
        }));
        // Each glyph's centre, as a radius and a clockwise-from-12 angle about
        // the dial centre, in the SVG's own units.
        const centre = svg.viewBox.baseVal.width / 2;
        const labels = Array.from(svg.querySelectorAll<SVGTextElement>(".rotary-encoder-etch-face")).map((text) => {
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
        expect(label.font).toBeCloseTo(geometry.labelFont, 1);
        expect(label.glyphs.length).toBeGreaterThan(0);
        for (const glyph of label.glyphs) {
          expect(Math.abs(glyph.radius - geometry.radii[index])).toBeLessThanOrEqual(geometry.labelFont * 0.2 + 0.5);
          expect(Math.abs(glyph.angle)).toBeGreaterThan(135);
        }
      });
      await shot(root, `size-${size}`);
    });
  }
});
