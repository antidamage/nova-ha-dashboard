// Shared harness for the ColorEncoder suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, expect } from "vitest";
import { ColorEncoder } from "./ColorEncoder";
import { type Hsva } from "./colorEncoderModel";

/** The 200px dial's box: --re-outer is 1.244 knob diameters. */
export const DIAL_BOX = 248.8;
export const CENTRE = DIAL_BOX / 2;
/** Where the test grabs the knob: well outside the dead centre. */
export const GRIP = CENTRE * 0.8;

/** The colour every ColorEncoder suite starts from. */
export const start: Hsva = { h: 200, s: 50, v: 50, a: 100 };

/** Registers the pointer-capture shim, the fixed dial box, and the teardown. */
export function useDialHarness() {
  beforeAll(() => {
    // jsdom does not implement pointer capture; the dial calls it on press.
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => undefined;
    }
    // It lays nothing out either, and an angular drag needs the dial's box. Only
    // the dial gets one: the knob label's fitting probe measures itself and must
    // keep reading zero, so that everything "fits" here as it did before.
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function boxed(this: HTMLElement) {
      if (!this.classList?.contains("rotary-encoder-dial")) return real.call(this);
      return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
  });
}

/** A point on the knob at `angle`, clockwise degrees from 12 o'clock. */
export function at(angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: CENTRE + GRIP * Math.sin(radians), clientY: CENTRE - GRIP * Math.cos(radians) };
}

/**
 * Turns the knob by `degrees`, the way a hand does: press, sweep round the
 * centre, release. Long turns are broken into steps under a half-turn, since a
 * single sample past 180° is ambiguous — as it is for a real pointer.
 */
export function turn(dial: HTMLElement, degrees: number, modifiers: { shiftKey?: boolean } = {}, from = 0) {
  const steps = Math.max(1, Math.ceil(Math.abs(degrees) / 90));
  fireEvent.pointerDown(dial, { buttons: 1, ...at(from), pointerId: 1 });
  for (let step = 1; step <= steps; step += 1) {
    fireEvent.pointerMove(dial, { buttons: 1, ...at(from + (degrees * step) / steps), pointerId: 1, ...modifiers });
  }
  fireEvent.pointerUp(dial, { ...at(from + degrees), pointerId: 1 });
}

/** Degrees of turn that move a 0–100 channel by `percent`. */
export function degreesFor(percent: number) {
  return percent * 2.7;
}

/** A parent that stores what the dial sends, as every real caller does. */
export function Controlled({ initial, ...props }: { initial: Hsva } & Omit<React.ComponentProps<typeof ColorEncoder>, "value" | "onChange">) {
  const [value, setValue] = useState<Hsva>(initial);
  return <ColorEncoder {...props} value={value} onChange={setValue} />;
}

export function tap(dial: HTMLElement) {
  fireEvent.pointerDown(dial, { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(dial, { clientX: 51, clientY: 50, pointerId: 1 });
}

export function litChannel(container: HTMLElement) {
  const lit = container.querySelectorAll('.rotary-encoder-led[data-lit="true"]');
  expect(lit).toHaveLength(1);
  return (lit[0] as HTMLElement).dataset.channel;
}
