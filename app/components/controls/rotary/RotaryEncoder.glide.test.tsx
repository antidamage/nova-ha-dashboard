import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RotaryEncoderRing } from "../../RotaryEncoder";
import { ARC_END, ARC_START, fractionAt, ringGeometry } from "../../rotaryEncoderGeometry";
import { RING_GLIDE_DEG_PER_SEC } from "./constants";
import { Dial, at, useDialHarness } from "./RotaryEncoder.fixtures";

useDialHarness();

/**
 * A stepping ring is drawn from where its thumb has *reached*, not from where
 * its value was sent (specs/color-encoder.md, "A step glides, it never snaps").
 * These read the drawn fraction back out of the thumb's own path, so they
 * measure what the eye sees rather than what the ring was handed.
 *
 * The ring throughout is the aircon's Manual Mode ring: four stops, cool → dry →
 * fan → heat, a third of the arc apart.
 */
const geometry = ringGeometry(200, 1);
const radius = geometry.radii[0];
const half = geometry.thumbHalfAngle[0];
const sweep = ARC_END - ARC_START;
/** Where a stop sits, as the angle to press at: 0 is cool, 1 is heat. */
const angleOf = (fraction: number) => ARC_START + half + fraction * (ARC_END - ARC_START - 2 * half);

const DRY = 1 / 3;
const FAN = 2 / 3;
/** How far the thumb gets in one 60Hz frame, as a fraction of the arc. */
const FRAME_TRAVEL = (RING_GLIDE_DEG_PER_SEC / sweep) * 0.016;

function ringsSvg(container: HTMLElement) {
  const svg = container.querySelector("svg.rotary-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg;
}

/** The fraction the thumb of ring 0 is actually drawn at. */
function drawnFraction(container: HTMLElement) {
  return drawnFractionAt(container, 0);
}

/** Runs the glide's clock: a frame per 16ms, the first of which only starts it. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** A controlled stepping ring that echoes what it is given, as the knobs do. */
function SteppedDial({ onChange, kind, step, min = 0, max = 3, glide }: {
  onChange: (value: number) => void;
  kind?: "selector";
  step?: number;
  min?: number;
  max?: number;
  glide?: boolean;
}) {
  const [value, setValue] = useState(min);
  const ring: RotaryEncoderRing = {
    id: "mode",
    label: "Mode",
    kind,
    value,
    min,
    max,
    step,
    glide,
    valueText: (live) => `${Math.round(live)}`,
    valueTextWidest: `${max}`,
    onChange: (next) => {
      onChange(next);
      setValue(next);
    },
  };
  return <Dial rings={[ring]} />;
}

/** Presses at the start of the arc and drags to `fraction` in one sample. */
function dragTo(container: HTMLElement, fraction: number) {
  const svg = ringsSvg(container);
  fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(0)) });
  if (fraction !== 0) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(fraction)) });
  return svg;
}

/** The dial's centre in SVG units, and its ring geometry, read from the markup. */
function dialGeometry(container: HTMLElement) {
  const svg = ringsSvg(container);
  const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  const count = svg.querySelectorAll("[data-ring-index]").length;
  return { centre: (viewBox[2] || geometry.footprint) / 2, rings: ringGeometry(200, count) };
}

/** The drawn fraction of a ring, from the middle of its thumb's own little arc. */
function drawnFractionAt(container: HTMLElement, index = 0, end: number = ARC_END) {
  const { centre, rings } = dialGeometry(container);
  const path = ringsSvg(container).querySelector(`[data-ring-index="${index}"] .rotary-encoder-thumb-body`);
  const numbers = (path?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 9) throw new Error(`no thumb arc on ring ${index}`);
  const angleOfPoint = (x: number, y: number) => (Math.atan2(x - centre, -(y - centre)) * 180) / Math.PI;
  const middle = (angleOfPoint(numbers[0], numbers[1]) + angleOfPoint(numbers[7], numbers[8])) / 2;
  return fractionAt(middle, rings.thumbHalfAngle[index], end);
}

/**
 * The arc the ring actually drew, in degrees — the well path runs ARC_START to
 * the fitted end, so a ring shortened to fit its label reports less than 270.
 */
function sweepOf(container: HTMLElement) {
  const { centre } = dialGeometry(container);
  const well = ringsSvg(container).querySelector(".rotary-encoder-well");
  const numbers = (well?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 9) throw new Error(`no well arc: ${well?.getAttribute("d")}`);
  const angleOfPoint = (x: number, y: number) => (Math.atan2(x - centre, -(y - centre)) * 180) / Math.PI;
  return Math.max(angleOfPoint(numbers[0], numbers[1]), angleOfPoint(numbers[7], numbers[8])) - ARC_START;
}

/**
 * jsdom lays nothing out, so the component's text measuring returns 0 and no
 * ring is ever shortened. Stubbing the width makes a long label pull its ring's
 * end back, which is the case `ringSweep` exists for. jsdom implements no
 * SVGTextElement, so the stub goes on the base class the probe actually is.
 */
function stubTextWidth(pxPerCharacter: number) {
  const proto = (window.SVGTextElement ?? window.SVGElement)?.prototype as unknown as Record<string, unknown> | undefined;
  if (!proto) throw new Error("no SVG element class in this environment");
  proto.getComputedTextLength = function measured(this: SVGElement) {
    return (this.textContent ?? "").length * pxPerCharacter;
  };
  return () => {
    delete proto.getComputedTextLength;
  };
}

/** One dial carrying two stepping rings: the Mode and Fan shape. */
function TwoRingDial({ onChange }: { onChange: () => void }) {
  const [mode, setMode] = useState(0);
  const [fan, setFan] = useState(0);
  const rings: RotaryEncoderRing[] = [
    {
      id: "mode", label: "Mode", kind: "selector", value: mode, min: 0, max: 3, step: 1,
      onChange: (next) => { onChange(); setMode(next); },
    },
    {
      id: "fan", label: "Fan", value: fan, min: 0, max: 6, step: 1,
      onChange: (next) => { onChange(); setFan(next); },
    },
  ];
  return <Dial rings={rings} />;
}

describe("a stepping ring's glide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("eases its thumb to the next stop instead of snapping to it", () => {
    const onChange = vi.fn();
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={onChange} />);

    dragTo(container, DRY);
    // The value is the stop at once; only the drawing lags behind it.
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(drawnFraction(container)).toBeCloseTo(0, 3);

    // Three frames in: part of the way, at the one speed every step uses.
    advance(64);
    expect(drawnFraction(container)).toBeGreaterThan(FRAME_TRAVEL * 2);
    expect(drawnFraction(container)).toBeCloseTo(FRAME_TRAVEL * 3, 3);
    expect(drawnFraction(container)).toBeLessThan(DRY);

    advance(400);
    expect(drawnFraction(container)).toBeCloseTo(DRY, 3);
  });

  it("makes a longer step take longer, at the same speed per degree", () => {
    const long = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);
    dragTo(long.container, 1);
    // By the time a one-stop move is home, the three-stop move is only past it.
    advance(224);
    expect(drawnFraction(long.container)).toBeCloseTo(FRAME_TRAVEL * 13, 3);
    expect(drawnFraction(long.container)).toBeGreaterThan(DRY);
    advance(400);
    expect(drawnFraction(long.container)).toBeCloseTo(1, 3);
    long.unmount();

    const short = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);
    dragTo(short.container, DRY);
    advance(224);
    // The short step was over long before this; the long one was still moving.
    expect(drawnFraction(short.container)).toBeCloseTo(DRY, 3);
  });

  it("targets the furthest stop a fast drag reached, never the ones between", () => {
    const onChange = vi.fn();
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={onChange} />);

    // One sample straight past dry and fan to heat: the value must not be held
    // at an intermediate stop while the thumb catches up.
    dragTo(container, 1);
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([3]);
    advance(64);
    const partWay = drawnFraction(container);
    expect(partWay).toBeLessThan(FAN);

    // Dragged back mid-travel: the thumb turns round for fan where it is. It
    // does not run on to heat first, and never passes fan on the way there.
    fireEvent.pointerMove(ringsSvg(container), { buttons: 1, pointerId: 1, ...at(radius, angleOf(FAN)) });
    expect(onChange.mock.lastCall?.[0]).toBe(2);
    advance(64);
    expect(drawnFraction(container)).toBeGreaterThan(partWay);
    expect(drawnFraction(container)).toBeLessThanOrEqual(FAN);

    advance(600);
    expect(drawnFraction(container)).toBeCloseTo(FAN, 3);
  });

  it("finishes the move it was on when the pointer is released part-way", () => {
    const onChange = vi.fn();
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={onChange} />);

    const svg = dragTo(container, 1);
    advance(64);
    const released = drawnFraction(container);
    expect(released).toBeGreaterThan(0);
    expect(released).toBeLessThan(1);

    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, angleOf(1)) });
    expect(onChange).toHaveBeenLastCalledWith(3);
    // A frame later it is still travelling rather than showing the destination
    // at once, and then it arrives.
    advance(32);
    const after = drawnFraction(container);
    expect(after).toBeGreaterThan(released);
    expect(after).toBeLessThan(1);
    advance(600);
    expect(drawnFraction(container)).toBeCloseTo(1, 3);
  });

  it("starts a second glide from rest at the same speed, not in one jump", () => {
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);
    const svg = dragTo(container, DRY);
    advance(400);
    expect(drawnFraction(container)).toBeCloseTo(DRY, 3);
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, angleOf(DRY)) });

    // A second gesture, from a ring already at rest. Its clock has to start
    // again: carrying the last frame's timestamp over would make the first frame
    // of this glide look seconds long, and the thumb would arrive in one jump.
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(DRY)) });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(0)) });
    advance(32);
    expect(drawnFraction(container)).toBeCloseTo(DRY - FRAME_TRAVEL, 3);

    advance(400);
    expect(drawnFraction(container)).toBeCloseTo(0, 3);
  });

  it("leaves a ring with no step following the pointer exactly", () => {
    const { container } = render(<SteppedDial onChange={vi.fn()} />);

    dragTo(container, 0.25);
    expect(drawnFraction(container)).toBeCloseTo(0.25, 3);
    advance(64);
    expect(drawnFraction(container)).toBeCloseTo(0.25, 3);
  });

  it("snaps, as every eased control does, in full lite", () => {
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "lite");
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);

    dragTo(container, 1);
    expect(drawnFraction(container)).toBeCloseTo(1, 3);
    advance(64);
    expect(drawnFraction(container)).toBeCloseTo(1, 3);
  });

  it("keeps a fine-step ring tracking the finger exactly", () => {
    // The sleep-timer shape: a 2-minute step across eight hours is a rounding
    // rule, not a discrete control — it is dragged by eye, so its thumb must not
    // trail the finger (Adeline, 2026-09-21).
    const onChange = vi.fn();
    const { container } = render(<SteppedDial onChange={onChange} step={2} min={0} max={480} />);

    dragTo(container, 1 / 3);
    expect(onChange).toHaveBeenLastCalledWith(160);
    // Drawn where the value is, immediately: no travel is started at all.
    expect(drawnFraction(container)).toBeCloseTo(1 / 3, 3);
    advance(64);
    expect(drawnFraction(container)).toBeCloseTo(1 / 3, 3);
  });

  it("glides a coarse-stepped slider as well as a selector", () => {
    // The aircon Fan ring: kind defaults to slider, and its step is coarse.
    const onChange = vi.fn();
    const { container } = render(<SteppedDial onChange={onChange} step={1} min={0} max={6} />);

    dragTo(container, 1 / 6);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(drawnFraction(container)).toBeCloseTo(0, 3);
    advance(64);
    expect(drawnFraction(container)).toBeGreaterThan(FRAME_TRAVEL * 2);
    expect(drawnFraction(container)).toBeLessThan(1 / 6);
    advance(400);
    expect(drawnFraction(container)).toBeCloseTo(1 / 6, 3);
  });

  it("takes an explicit glide flag either way", () => {
    const coarse = render(<SteppedDial onChange={vi.fn()} step={1} min={0} max={6} glide={false} />);
    dragTo(coarse.container, 1 / 6);
    expect(drawnFraction(coarse.container)).toBeCloseTo(1 / 6, 3);
    coarse.unmount();

    const fine = render(<SteppedDial onChange={vi.fn()} step={2} min={0} max={480} glide />);
    dragTo(fine.container, 1 / 3);
    expect(drawnFraction(fine.container)).toBeCloseTo(0, 3);
    advance(400);
    expect(drawnFraction(fine.container)).toBeCloseTo(1 / 3, 3);
  });

  it("glides at the same degrees per second over a shortened arc", () => {
    // The aircon Mode and Fan rings are pulled back to fit their labels and
    // values. The rate is degrees of the ring's own arc, so a shorter arc covers
    // more of itself per frame (`ringSweep`).
    const restore = stubTextWidth(60);
    try {
      const { container } = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);
      const sweep = sweepOf(container);
      expect(sweep).toBeLessThan(ARC_END - ARC_START - 1);
      // The thumb travels the *fitted* arc, so a destination is an angle on it,
      // not on the full 270° track.
      const end = ARC_START + sweep;
      const angleAt = (fraction: number) => ARC_START + half + fraction * (end - ARC_START - 2 * half);

      const svg = ringsSvg(container);
      fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angleAt(0)) });
      fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angleAt(2 / 3)) });
      advance(64);
      // Three travelling frames, at the ring's own sweep. Measured against the
      // fitted end, because that is the arc the thumb travels.
      expect(drawnFractionAt(container, 0, end)).toBeCloseTo(3 * (RING_GLIDE_DEG_PER_SEC / sweep) * 0.016, 3);
      advance(600);
      expect(drawnFractionAt(container, 0, end)).toBeCloseTo(2 / 3, 3);
    } finally {
      restore();
    }
  });

  it("travels two stepping rings on one dial independently", () => {
    const onChange = vi.fn();
    const { container } = render(<TwoRingDial onChange={onChange} />);
    const two = ringGeometry(200, 2);
    const svg = ringsSvg(container);

    // Press and drag ring 1 (the fan, seven stops). Ring 0 (the selector, four)
    // must keep its thumb exactly where it is.
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(two.radii[1], angleOf(0)) });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(two.radii[1], angleOf(1 / 3)) });
    advance(64);
    expect(drawnFractionAt(container, 1)).toBeGreaterThan(0);
    expect(drawnFractionAt(container, 1)).toBeLessThan(1 / 3);
    expect(drawnFractionAt(container, 0)).toBeCloseTo(0, 3);

    advance(600);
    expect(drawnFractionAt(container, 1)).toBeCloseTo(1 / 3, 3);
  });

  it("drops a travel when the device flips to full lite mid-move", () => {
    const { container } = render(<SteppedDial kind="selector" step={1} onChange={vi.fn()} />);

    dragTo(container, 1);
    advance(64);
    const partWay = drawnFraction(container);
    expect(partWay).toBeGreaterThan(0);
    expect(partWay).toBeLessThan(1);

    // The device switches to full lite while the thumb is still travelling.
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "lite");
    act(() => {
      window.dispatchEvent(new Event("nova-experience-mode-change"));
    });

    expect(drawnFraction(container)).toBeCloseTo(1, 3);
    advance(64);
    expect(drawnFraction(container)).toBeCloseTo(1, 3);
  });
});
