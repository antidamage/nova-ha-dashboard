import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ARC_END, ARC_START, ringGeometry } from "../../rotaryEncoderGeometry";
import { RING_GLIDE_DEG_PER_SEC } from "./constants";
import { at, useDialHarness } from "./RotaryEncoder.fixtures";
import {
  FRAME_TRAVEL,
  TwoRingDial,
  SteppedDial,
  advance,
  angleOf,
  dragTo,
  drawnFraction,
  drawnFractionAt,
  half,
  radius,
  ringsSvg,
  stubTextWidth,
  sweepOf,
  useGlideClock,
} from "./RotaryEncoder.glide.fixtures";

useDialHarness();
useGlideClock();

/**
 * Which rings glide. A `step` is not the same thing as a discrete control — the
 * sleep-timer rings carry one only to round a continuous value — so the rule is
 * coarseness (`RING_GLIDE_MIN_STEP_SHARE`), with `glide` to override it
 * (specs/color-encoder.md, "Only a coarse step glides").
 */
describe("which rings glide", () => {
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
