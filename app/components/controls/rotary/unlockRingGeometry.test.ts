import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UNLOCK_RING_INNER, UNLOCK_RING_OUTER, UNLOCK_RING_RADIUS, UNLOCK_RING_WIDTH } from "../../../../lib/orb-modules/tech.unlock";
import { readCss } from "../../../styles/readCss";
import { BEVEL_SHARE, DIAL_RADIUS_SHARE, RING_SHARE, UNLOCK_RING_SHARE } from "./constants";

// The embossed unlock ring is one surface drawn in two places: the knob's CSS
// (app/styles/controls/rotary-unlock-ring.css over rotary-encoder.css) and, on
// the status orb, the Tech module's own unit-space band
// (lib/orb-modules/tech.unlock.ts). Both are read here as text, because a band
// that drifts a percent out of place is invisible in a unit test and obvious on
// a wall panel — and nothing else would fail.
//
// constants.ts points at this file by name. It is the reason the shares and the
// custom properties are allowed to be written twice at all.

const css = readCss();
const here = __dirname;
const unlockCss = readFileSync(join(here, "../../../styles/controls/rotary-unlock-ring.css"), "utf8");
const encoderSource = readFileSync(join(here, "RotaryEncoder.tsx"), "utf8");
const indicatorSource = readFileSync(join(here, "../../orb-info/OrbDialIndicator.tsx"), "utf8");

/** A custom property's value, from the whole bundle. */
function property(name: string) {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`rotary-encoder.css declares no ${name}`);
  return match[1].trim();
}

/** `--re-x: calc(var(--re-size) * N)` as N. */
function share(name: string) {
  const match = /^calc\(var\(--re-size\) \* ([\d.]+)\)$/.exec(property(name));
  if (!match) throw new Error(`${name} is not a share of --re-size: ${property(name)}`);
  return Number(match[1]);
}

/** Every percentage in a radial-gradient mask, in order. */
function percentages(value: string) {
  return [...value.matchAll(/([\d.]+)%/g)].map((match) => Number(match[1]));
}

/**
 * The masks are written to two decimals by hand, so a hand-computed edge can
 * disagree with them by half a hundredth of a percent and mean the same thing.
 */
function expectPercent(actual: number, expected: number, label: string) {
  expect(Math.abs(actual - expected), `${label}: ${actual}% against ${expected.toFixed(4)}%`).toBeLessThanOrEqual(0.02);
}

describe("the unlock ring's share of the knob", () => {
  it("keeps the CSS stack and constants.ts in step", () => {
    expect(share("--re-unlock")).toBe(UNLOCK_RING_SHARE);
    expect(share("--re-ring")).toBe(RING_SHARE);
    expect(share("--re-bevel")).toBe(BEVEL_SHARE);
    // Half the knob, then the unlock ring, ring and bevel: the orb divides a
    // diameter by the whole of it to put the colour ring on its rim.
    expect(DIAL_RADIUS_SHARE).toBe(0.5 + UNLOCK_RING_SHARE + RING_SHARE + BEVEL_SHARE);
  });

  it("moves every outer layer out by the unlock ring and no further", () => {
    // Written out rather than computed: this is the arrangement Adeline asked
    // for ("I don't want the relative arrangement of the outer layers to
    // change"), and it should be read as such when it changes.
    expect(property("--re-outer")).toBe(
      "calc(var(--re-size) + 2 * var(--re-unlock) + 2 * var(--re-ring) + 2 * var(--re-bevel))",
    );
    expect(property("--re-ring-outer")).toBe("calc(var(--re-size) + 2 * var(--re-unlock) + 2 * var(--re-ring))");
  });
});

describe("the band's annulus masks", () => {
  // Both masks sit on an element the size of --re-ring-outer, so every edge is
  // a fraction of half of it: 0.5 + unlock + ring knob diameters.
  const half = 0.5 + UNLOCK_RING_SHARE + RING_SHARE;
  const knobEdge = (0.5 / half) * 100;
  const bandEdge = ((0.5 + UNLOCK_RING_SHARE) / half) * 100;

  it("cuts the colour ring from the unlock ring's outer edge to the rim", () => {
    const [outerFeather, opaque, end] = percentages(property("--re-annulus"));
    expectPercent(outerFeather, bandEdge, "colour ring's inner edge");
    expectPercent(opaque, bandEdge + 0.2, "its outer feather");
    expect(end).toBe(100);
  });

  it("cuts the unlock ring from the knob's edge to the colour ring's inner edge", () => {
    const [innerFeather, start, outerFeather, end] = percentages(property("--re-unlock-annulus"));
    expectPercent(innerFeather, knobEdge - 0.2, "the knob's edge, feathered inwards");
    expectPercent(start, knobEdge, "the knob's edge");
    expectPercent(outerFeather, bandEdge, "the colour ring's inner edge");
    expectPercent(end, bandEdge + 0.2, "its outer feather");
  });
});

describe("the ring's layers", () => {
  it("styles every layer the two renderers mount", () => {
    const layers = ["-ring", "-glass", "-lit", "-shift", "-spec"];
    for (const layer of layers) {
      expect(unlockCss, `rotary-unlock-ring.css has no .rotary-encoder-unlock${layer}`).toContain(
        `.rotary-encoder-unlock${layer}`,
      );
    }
    // The knob and the orb indicator mount the same markup, so a layer added to
    // one and not the other is a surface that draws on only half the panels.
    for (const source of [encoderSource, indicatorSource]) {
      for (const layer of ["-ring", "-glass", "-lit", "-shift", "-spec"]) {
        expect(source, `no rotary-encoder-unlock${layer} in this renderer`).toContain(
          `rotary-encoder-unlock${layer}`,
        );
      }
    }
  });

  it("lights the band in the theme's own unlock-ring colour only while the dial is unlocked", () => {
    const lit = /\.rotary-encoder-unlock-lit\s*\{[^}]*\}/.exec(unlockCss)?.[0] ?? "";
    expect(lit).toContain("opacity: 0");
    expect(unlockCss).toMatch(/\.rotary-encoder\[data-locked="false"\] \.rotary-encoder-unlock-lit\s*\{[^}]*opacity: 1/);
    // The glow is the band's own colour, and the lit layer is that colour too
    // rather than a flat white. Both take the Unlock Ring slot, which is a
    // colour of its own beside the LEDs (Adeline, 2026-09-21); nothing on the
    // band reads the LED colour directly any more.
    expect(unlockCss).toMatch(/\.rotary-encoder\[data-locked="false"\] \.rotary-encoder-unlock-ring\s*\{[^}]*--re-unlock-on-rgb/);
    expect(lit).toContain("var(--re-unlock-on)");
    expect(unlockCss).not.toContain("--re-led-on");
    // And the slot falls back to the LED colour, which is what the band
    // followed before it had one (specs/color-encoder.md).
    expect(property("--re-unlock-on")).toBe("var(--nova-unlock-ring-color, var(--re-led-on))");
    expect(property("--re-unlock-on-rgb")).toBe("var(--nova-unlock-ring-rgb, var(--re-led-on-rgb))");
  });

  it("hue-shifts the bottom of the lit band by 5deg and leaves the top bright", () => {
    const shift = /\.rotary-encoder-unlock-shift\s*\{[^}]*\}/.exec(unlockCss)?.[0] ?? "";
    expect(shift).toContain("hue-rotate(5deg)");
    // Masked to the lower half, so the shift never reaches the top of the band.
    expect(shift).toMatch(/mask: linear-gradient\(180deg, transparent \d+%, #000 \d+%\)/);
    // And the wash it sits under runs light at the top to dark at the bottom.
    const glass = /\.rotary-encoder-unlock-glass\s*\{[^}]*\}/.exec(unlockCss)?.[0] ?? "";
    expect(glass).toMatch(/linear-gradient\(180deg/);
    const alpha = [...glass.matchAll(/rgba\(\d+, \d+, [\d]+, ([\d.]+)\)/g)].map((match) => Number(match[1]));
    expect(alpha.length).toBeGreaterThan(2);
    expect(alpha[0]).toBeLessThan(alpha[alpha.length - 1]);
  });
});

describe("the band the Tech orb draws", () => {
  // The orb pins its rim, so the module's numbers are the knob's shares over
  // DIAL_RADIUS_SHARE. If the spacer moves again, this is what catches a module
  // left behind at the old radius.
  it("is the knob's band, in the orb's unit space", () => {
    expect(UNLOCK_RING_INNER * DIAL_RADIUS_SHARE).toBeCloseTo(0.5, 3);
    expect(UNLOCK_RING_OUTER * DIAL_RADIUS_SHARE).toBeCloseTo(0.5 + UNLOCK_RING_SHARE, 3);
    expect(UNLOCK_RING_RADIUS).toBeCloseTo((UNLOCK_RING_INNER + UNLOCK_RING_OUTER) / 2, 6);
    expect(UNLOCK_RING_WIDTH).toBeCloseTo(UNLOCK_RING_OUTER - UNLOCK_RING_INNER, 6);
  });
});
