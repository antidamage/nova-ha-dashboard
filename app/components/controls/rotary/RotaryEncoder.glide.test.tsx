import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

/** The fraction the thumb is actually drawn at, from its arc's two ends. */
function drawnFraction(container: HTMLElement) {
  const path = ringsSvg(container).querySelector(".rotary-encoder-thumb-body");
  const numbers = (path?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 9) throw new Error(`no thumb arc: ${path?.getAttribute("d")}`);
  const centre = geometry.footprint / 2;
  const angleOfPoint = (x: number, y: number) => (Math.atan2(x - centre, -(y - centre)) * 180) / Math.PI;
  const middle = (angleOfPoint(numbers[0], numbers[1]) + angleOfPoint(numbers[7], numbers[8])) / 2;
  return fractionAt(middle, half, ARC_END);
}

/** Runs the glide's clock: a frame per 16ms, the first of which only starts it. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** A controlled stepping ring that echoes what it is given, as the knobs do. */
function SteppedDial({ onChange, kind, step }: { onChange: (value: number) => void; kind?: "selector"; step?: number }) {
  const [value, setValue] = useState(0);
  const ring: RotaryEncoderRing = {
    id: "mode",
    label: "Mode",
    kind,
    value,
    min: 0,
    max: 3,
    step,
    valueText: (live) => `${Math.round(live)}`,
    valueTextWidest: "3",
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
});
