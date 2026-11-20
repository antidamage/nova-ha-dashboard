// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DemoTemperatureDial } from "../../TemperatureEncoderDemo";
import { LAYER_SETS, PARAGRAPH_MAX_CHARS } from "./catalogue";
import { FLUID_TERMS, termUniforms } from "./fluidTerms";

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;

/** Dial children that are not a layer of their own. */
const NOT_LAYERS = new Set([
  "rotary-encoder-checker", // the colour picker's transparency checks; not on any knob the tour shows
]);

describe("layer catalogue", () => {
  it("keeps every paragraph to three sentences and 280 characters", () => {
    for (const set of Object.values(LAYER_SETS)) {
      for (const layer of set.layers) {
        expect(layer.why.length, layer.id).toBeLessThanOrEqual(PARAGRAPH_MAX_CHARS);
        expect(sentences(layer.why), layer.id).toBeLessThanOrEqual(3);
      }
    }
  });

  it("has unique layer ids in each set", () => {
    for (const set of Object.values(LAYER_SETS)) {
      expect(new Set(set.layers.map((layer) => layer.id)).size, set.id).toBe(set.layers.length);
    }
  });

  // The catalogue must not drift from the knob: a renamed layer, or a new one
  // it does not name, fails here until the catalogue is updated with it.
  it("names every layer a mounted knob actually has", () => {
    const { container } = render(<DemoTemperatureDial id="catalogue" />);
    const root = container.querySelector(".rotary-encoder");
    expect(root).not.toBeNull();
    const selectors = LAYER_SETS.rotary.layers.flatMap((layer) => (layer.source.kind === "dom" ? [layer.source.selector] : []));
    for (const selector of selectors) {
      if (selector.includes("title-arc")) continue; // only a titled knob has one
      expect(root!.querySelector(selector), selector).not.toBeNull();
    }
    const dial = root!.querySelector(".rotary-encoder-dial")!;
    const unnamed = Array.from(dial.children)
      .filter((child) => !selectors.some((selector) => child.matches(selector)))
      .map((child) => String(child.className))
      .filter((name) => !NOT_LAYERS.has(name));
    expect(unnamed).toEqual([]);
  });

  it("builds the background shader up one term per card", () => {
    const effect = { peakIntensity: 80, falloffPower: 50, warpAmplitude: 40, hueSpread: 30, apexGlow: 20, textureScale: 100, textureUrl: null } as never;
    const steps = FLUID_TERMS.map((term) => termUniforms(term, effect));
    expect(steps[0]).toEqual({ peak: 0, warp: 0, hue: 0, apex: 0, texture: false });
    expect(steps[1]).toMatchObject({ peak: 0.8, warp: 0.4, hue: 0 });
    expect(steps[2]).toMatchObject({ hue: 0.3, apex: 0 });
    expect(steps[3]).toMatchObject({ apex: 0.2, texture: false });
    expect(steps[4]).toMatchObject({ texture: true });
  });
});
