// Shared harness for the RotaryEncoder suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { cleanup } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, vi } from "vitest";
import { RotaryEncoder } from "../../RotaryEncoder";

/** The 200px dial's box: the footprint is 1.244 knob diameters. */
export const DIAL_BOX = 248.8;
export const CENTRE = DIAL_BOX / 2;

/** Registers the pointer-capture shim, the fixed dial box, and the teardown. */
export function useDialHarness() {
  beforeAll(() => {
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => undefined;
    }
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
      if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
      return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

/** jsdom lays nothing out, so the rings' SVG is a zero box at the origin. */
export function at(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: radius * Math.sin(radians), clientY: -radius * Math.cos(radians) };
}

export function svgOf(container: HTMLElement) {
  const svg = (container.ownerDocument ?? document).querySelector("svg.rotary-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg as SVGSVGElement;
}

export const THREE = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

export function Dial({ leds = THREE, ...props }: Partial<React.ComponentProps<typeof RotaryEncoder>> = {}) {
  const [value, setValue] = useState(50);
  return (
    <RotaryEncoder
      leds={leds}
      range={{ min: 0, max: 100 }}
      value={value}
      onChange={setValue}
      {...props}
    />
  );
}
