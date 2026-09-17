// Shared harness for the ColorEncoder ring suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, vi } from "vitest";
import { ColorEncoder, type ColorEncoderRing } from "./ColorEncoder";
import type { Hsva } from "./colorEncoderModel";

/** The 200px dial's box: --re-outer is 1.244 knob diameters. */
export const DIAL_BOX = 248.8;
export const DIAL_CENTRE = DIAL_BOX / 2;

/** Registers the pointer-capture shim, the fixed dial box, and the teardown. */
export function useDialHarness() {
  beforeAll(() => {
    // jsdom implements pointer capture on neither HTML nor SVG elements.
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined;
    }
    // The knob turns by the angle swept about its centre, so it needs a box.
    // Everything else keeps jsdom's zero box, which is what lets the ring tests
    // place a pointer by angle and radius about the origin.
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
      if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
      return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
}

/** A point on the knob at `angle`, clockwise degrees from 12 o'clock. */
export function onKnob(angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    clientX: DIAL_CENTRE + DIAL_CENTRE * 0.8 * Math.sin(radians),
    clientY: DIAL_CENTRE - DIAL_CENTRE * 0.8 * Math.cos(radians),
  };
}

export const start: Hsva = { h: 200, s: 50, v: 50, a: 100 };

/**
 * jsdom lays nothing out, so the rings' SVG reports a zero box at the origin:
 * the component then reads client coordinates as offsets from the dial's
 * centre, which lets these tests place a pointer by angle and radius.
 */
export function at(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: radius * Math.sin(radians), clientY: -radius * Math.cos(radians) };
}

export function Controlled({ rings = 1, initial = [50, 50, 50, 50, 50], size = 200, spy }: {
  rings?: number;
  initial?: number[];
  size?: number;
  spy?: { change?: (index: number, value: number) => void; commit?: (index: number, value: number) => void };
}) {
  const [values, setValues] = useState(initial);
  const defs: ColorEncoderRing[] = Array.from({ length: rings }, (_, index) => ({
    id: `r${index}`,
    label: `Ring ${index}`,
    value: values[index] ?? 0,
    onChange: (value) => {
      spy?.change?.(index, value);
      setValues((current) => current.map((item, i) => (i === index ? value : item)));
    },
    onCommit: (value) => spy?.commit?.(index, value),
  }));
  return <ColorEncoder label="Lights" size={size} value={start} onChange={vi.fn()} rings={defs} />;
}

export function svgOf(container: HTMLElement) {
  const svg = container.querySelector("svg.rotary-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg as SVGSVGElement;
}
