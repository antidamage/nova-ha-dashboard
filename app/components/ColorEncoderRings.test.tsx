import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as haptics from "./haptics";
import { ColorEncoder, type ColorEncoderRing } from "./ColorEncoder";
import type { Hsva } from "./colorEncoderModel";
import {
  ARC_END,
  ARC_START,
  RING_LIMIT,
  THUMB_LENGTH,
  captionFont,
  dragStep,
  fractionAt,
  labelRoom,
  pointerAngle,
  ringAt,
  ringGeometry,
  thumbAngle,
  valueAt,
} from "./colorEncoderGeometry";

/** The 200px dial's box: --ce-outer is 1.244 knob diameters. */
const DIAL_BOX = 248.8;
const DIAL_CENTRE = DIAL_BOX / 2;

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
    if (!this.classList?.contains("color-encoder-dial")) return real.call(this);
    return { x: 0, y: 0, left: 0, top: 0, right: DIAL_BOX, bottom: DIAL_BOX, width: DIAL_BOX, height: DIAL_BOX, toJSON: () => ({}) } as DOMRect;
  };
});

/** A point on the knob at `angle`, clockwise degrees from 12 o'clock. */
function onKnob(angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    clientX: DIAL_CENTRE + DIAL_CENTRE * 0.8 * Math.sin(radians),
    clientY: DIAL_CENTRE - DIAL_CENTRE * 0.8 * Math.cos(radians),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const start: Hsva = { h: 200, s: 50, v: 50, a: 100 };

/**
 * jsdom lays nothing out, so the rings' SVG reports a zero box at the origin:
 * the component then reads client coordinates as offsets from the dial's
 * centre, which lets these tests place a pointer by angle and radius.
 */
function at(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: radius * Math.sin(radians), clientY: -radius * Math.cos(radians) };
}

function Controlled({ rings = 1, initial = [50, 50, 50, 50, 50], size = 200, spy }: {
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

function svgOf(container: HTMLElement) {
  const svg = container.querySelector("svg.color-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg as SVGSVGElement;
}

describe("ring geometry", () => {
  it("is 6% track and 2.5% gap at 200px", () => {
    const geometry = ringGeometry(200, 5);
    expect(geometry.pitch).toBeCloseTo(17);
    expect(geometry.track).toBeCloseTo(12);
    expect(geometry.gap).toBeCloseTo(5);
    expect(geometry.dialRadius).toBeCloseTo(124.4);
    expect(geometry.radii[0]).toBeCloseTo(124.4 + 5 + 6);
    geometry.radii.slice(1).forEach((radius, index) => expect(radius - geometry.radii[index]).toBeCloseTo(17));
  });

  it("floors the pitch at the label font plus 2px, keeping the track share", () => {
    for (const size of [56, 100]) {
      const geometry = ringGeometry(size, 5);
      expect(geometry.font).toBe(10);
      expect(geometry.pitch).toBe(12);
      expect(geometry.track / geometry.pitch).toBeCloseTo(6 / 8.5);
    }
  });

  it("never lets neighbouring labels overlap at any size", () => {
    for (let size = 50; size <= 200; size += 1) {
      const geometry = ringGeometry(size, 5);
      expect(geometry.pitch).toBeGreaterThanOrEqual(captionFont(size) + 2 - 1e-9);
    }
  });

  it("draws at most five rings", () => {
    expect(ringGeometry(200, 9).radii).toHaveLength(RING_LIMIT);
    expect(ringGeometry(200, 0).footprint).toBeCloseTo(200 * 1.244);
  });

  it("keeps the thumb on the track at both ends", () => {
    const geometry = ringGeometry(200, 3);
    geometry.radii.forEach((radius, index) => {
      const half = geometry.thumbHalfAngle[index];
      // Half the thumb's visible length, as an angle on this ring.
      expect(half).toBeCloseTo(((THUMB_LENGTH * geometry.track) / 2 / radius) * (180 / Math.PI));
      expect(thumbAngle(0, half) - half).toBeCloseTo(ARC_START);
      expect(thumbAngle(1, half) + half).toBeCloseTo(ARC_END);
      expect(fractionAt(thumbAngle(0.3, half), half)).toBeCloseTo(0.3);
    });
  });

  it("measures angles clockwise from 12 o'clock", () => {
    expect(pointerAngle(0, -1)).toBeCloseTo(0);
    expect(pointerAngle(1, 0)).toBeCloseTo(90);
    expect(pointerAngle(-1, 0)).toBeCloseTo(-90);
    expect(Math.abs(pointerAngle(0, 1))).toBeCloseTo(180);
  });

  it("places a press on the dial, a ring, or nothing by its distance", () => {
    const geometry = ringGeometry(200, 2);
    expect(ringAt(geometry, 100)).toBeNull();
    expect(ringAt(geometry, geometry.radii[0])).toBe(0);
    expect(ringAt(geometry, geometry.radii[1])).toBe(1);
    expect(ringAt(geometry, geometry.radii[1] + geometry.pitch)).toBeNull();
  });

  it("snaps to a step", () => {
    expect(valueAt(0.52, 0, 100, 5)).toBe(50);
    expect(valueAt(0.53, 0, 100, 5)).toBe(55);
    expect(valueAt(0.5, 10, 20)).toBe(15);
  });

  it("gives every label its gap less the track ends and clearance", () => {
    const geometry = ringGeometry(200, 1);
    expect(labelRoom(geometry, 0)).toBeCloseTo(geometry.radii[0] * (Math.PI / 2) - 2 * geometry.track);
  });
});

describe("dragging through the gap", () => {
  const half = 5;

  it("pins at the nearer end and never jumps across", () => {
    let drag = dragStep({ pinned: null, t: 0.9 }, 120, half);
    expect(drag.pinned).toBeNull();
    drag = dragStep(drag, 170, half);
    expect(drag).toEqual({ pinned: "max", t: 1 });
    // Out of the gap on the far side, at the min end: stays at max.
    drag = dragStep(drag, -130, half);
    expect(drag).toEqual({ pinned: "max", t: 1 });
    drag = dragStep(drag, -60, half);
    expect(drag.t).toBe(1);
    // Back on the arc in the max half: follows again.
    drag = dragStep(drag, 90, half);
    expect(drag.pinned).toBeNull();
    expect(drag.t).toBeCloseTo(fractionAt(90, half));
  });

  it("pins at min for a value in the lower half", () => {
    expect(dragStep({ pinned: null, t: 0.2 }, -170, half)).toEqual({ pinned: "min", t: 0 });
  });
});

describe("ColorEncoder", () => {
  it("puts the label on the knob, above the lights", () => {
    const { container } = render(<ColorEncoder label="Lights" value={start} onChange={vi.fn()} />);
    const label = container.querySelector(".color-encoder-label");
    expect(label?.parentElement?.classList.contains("color-encoder-dial")).toBe(true);
    const children = Array.from(label!.parentElement!.children);
    expect(children.indexOf(label!)).toBeLessThan(children.indexOf(container.querySelector(".color-encoder-leds")!));
    expect(screen.getByRole("slider", { name: "Lights" })).toBeTruthy();
  });

  it("draws one slider per ring, up to five, and warns past that", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rings = Array.from({ length: 6 }, (_, index) => ({ id: `r${index}`, label: `R${index}`, value: 0, onChange: vi.fn() }));
    render(<ColorEncoder value={start} onChange={vi.fn()} rings={rings} />);
    expect(screen.getAllByRole("slider")).toHaveLength(1 + RING_LIMIT);
    expect(warn).toHaveBeenCalled();
  });

  it("jumps the thumb to a tap on the track", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} initial={[10]} />);
    const radius = ringGeometry(200, 1).radii[0];
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 0) });
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.lastCall?.[1]).toBeCloseTo(50, 5);
    expect(screen.getByRole("slider", { name: "Ring 0" }).getAttribute("aria-valuenow")).toBe("50");
  });

  it("ignores a press in the label gap", () => {
    const change = vi.fn();
    const { container } = render(<Controlled spy={{ change }} />);
    const radius = ringGeometry(200, 1).radii[0];
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 180) });
    expect(change).not.toHaveBeenCalled();
  });

  it("drags the outer ring along the arc and commits once", () => {
    const change = vi.fn();
    const commit = vi.fn();
    const { container } = render(<Controlled rings={3} spy={{ change, commit }} />);
    const geometry = ringGeometry(200, 3);
    const radius = geometry.radii[2];
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
    for (const angle of [20, 40, 60, 90]) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 90) });
    expect(change.mock.calls.every(([index]) => index === 2)).toBe(true);
    const expected = fractionAt(90, geometry.thumbHalfAngle[2]) * 100;
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(expected, 5);
  });

  it("holds at the end when a drag runs on into the gap", () => {
    const commit = vi.fn();
    const { container } = render(<Controlled spy={{ commit }} initial={[80]} />);
    const radius = ringGeometry(200, 1).radii[0];
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 100) });
    for (const angle of [130, 160, -170, -140, -100]) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, -100) });
    expect(commit.mock.lastCall?.[1]).toBe(100);
  });

  it("steps with the arrow keys, finer with Shift, committing on key up", () => {
    const commit = vi.fn();
    render(<Controlled spy={{ commit }} />);
    const ring = screen.getByRole("slider", { name: "Ring 0" });
    fireEvent.keyDown(ring, { key: "ArrowRight" });
    fireEvent.keyUp(ring, { key: "ArrowRight" });
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(51);
    fireEvent.keyDown(ring, { key: "ArrowLeft", shiftKey: true });
    fireEvent.keyUp(ring, { key: "ArrowLeft", shiftKey: true });
    expect(commit.mock.lastCall?.[1]).toBeCloseTo(51 - 1 / 8);
  });

  it("takes no input on a disabled ring", () => {
    const change = vi.fn();
    const rings = [{ id: "a", label: "A", value: 20, disabled: true, onChange: change }];
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} rings={rings} />);
    fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(ringGeometry(200, 1).radii[0], 0) });
    fireEvent.keyDown(screen.getByRole("slider", { name: "A" }), { key: "ArrowRight" });
    expect(change).not.toHaveBeenCalled();
  });

  describe("clicks", () => {
    function clock() {
      let time = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => time);
      return (ms: number) => { time += ms; };
    }

    it("dial: press, silence while turning, release only if it changed", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      function Dial() {
        const [value, setValue] = useState(start);
        return <ColorEncoder label="Lights" defaultChannel="brightness" value={value} onChange={setValue} />;
      }
      render(<Dial />);
      const dial = screen.getByRole("slider", { name: "Lights" });

      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);
      for (let step = 1; step <= 30; step += 1) {
        advance(step <= 15 ? 16 : 600);
        fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(step * 8), pointerId: 1 });
      }
      expect(click).toHaveBeenCalledTimes(1);
      // 240° of turn takes brightness from 50 past its top, so it ends pinned.
      fireEvent.pointerUp(dial, { ...onKnob(240), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(2);

      // Brightness is now at its top; pushing further changes nothing.
      click.mockClear();
      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(60), pointerId: 1 });
      fireEvent.pointerUp(dial, { ...onKnob(60), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);

      // A drag out and back to where it started: silent release.
      click.mockClear();
      fireEvent.pointerDown(dial, { buttons: 1, ...onKnob(0), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(-20), pointerId: 1 });
      fireEvent.pointerMove(dial, { buttons: 1, ...onKnob(60), pointerId: 1 });
      fireEvent.pointerUp(dial, { ...onKnob(60), pointerId: 1 });
      expect(click).toHaveBeenCalledTimes(1);
    });

    it("ring: press, silence while dragging, release only if it changed", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[50]} />);
      const radius = ringGeometry(200, 1).radii[0];
      const svg = svgOf(container);

      fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
      expect(click).toHaveBeenCalledTimes(1);
      for (let angle = 10; angle <= 100; angle += 10) {
        advance(500);
        fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angle) });
      }
      expect(click).toHaveBeenCalledTimes(1);
      fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 100) });
      expect(click).toHaveBeenCalledTimes(2);

    });

    it("ring: pushing on past an end releases silently", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[100]} />);
      const radius = ringGeometry(200, 1).radii[0];
      const svg = svgOf(container);
      fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 134) });
      advance(500);
      fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, 170) });
      fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 170) });
      expect(click).toHaveBeenCalledTimes(1);
    });

    it("ring: a quick tap that jumps the thumb clicks once", () => {
      const click = vi.spyOn(haptics, "selectionHaptic").mockReturnValue(true);
      const advance = clock();
      const { container } = render(<Controlled initial={[10]} />);
      const radius = ringGeometry(200, 1).radii[0];
      fireEvent.pointerDown(svgOf(container), { buttons: 1, pointerId: 1, ...at(radius, 0) });
      advance(80);
      fireEvent.pointerUp(svgOf(container), { pointerId: 1, ...at(radius, 0) });
      expect(click).toHaveBeenCalledTimes(1);
    });
  });
});
