import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type RotaryEncoderRing } from "../../RotaryEncoder";
import {
  ARC_END,
  ARC_START,
  ARC_MIN_SPAN,
  LABEL_VALUE_CLEARANCE,
  captionFont,
  ringEndFor,
  ringGeometry,
  ringLabelFont,
  thumbAngle,
  fractionAt,
  gapLength,
} from "../../rotaryEncoderGeometry";
import { Dial, at, svgOf, useDialHarness } from "./RotaryEncoder.fixtures";

useDialHarness();

describe("ring kinds", () => {
  const geometry = ringGeometry(200, 1);
  const radius = geometry.radii[0];

  it("a selector snaps to its stops and fills the whole track, not up to the thumb", () => {
    const onCommit = vi.fn();
    const rings: RotaryEncoderRing[] = [{
      id: "mode",
      label: "Mode",
      kind: "selector",
      symmetric: true,
      value: 0,
      min: 0,
      max: 2,
      step: 1,
      fill: "#ff4a1c",
      onChange: vi.fn(),
      onCommit,
    }];
    const { container } = render(<Dial rings={rings} />);
    const svg = svgOf(container);
    // A press just past the middle stop lands on it, not between stops.
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 10) });
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 10) });
    expect(onCommit.mock.lastCall?.[0]).toBe(1);
    expect(container.querySelector(".rotary-encoder-fill")).toBeNull();
    const whole = svg.querySelector(".rotary-encoder-whole-fill");
    expect(whole?.getAttribute("stroke")).toBe("#ff4a1c");
  });

  it("a selector with no fill leaves an empty well", () => {
    const rings: RotaryEncoderRing[] = [{
      id: "mode", label: "Mode", kind: "selector", value: 1, min: 0, max: 2, step: 1, fill: null, onChange: vi.fn(),
    }];
    const { container } = render(<Dial rings={rings} />);
    const whole = svgOf(container).querySelector(".rotary-encoder-whole-fill");
    expect(whole?.getAttribute("stroke")).toBe("transparent");
    expect(whole?.getAttribute("data-on")).toBe("false");
  });

  it("a toggle flips on a tap, reports itself as a switch, and has no thumb", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const rings: RotaryEncoderRing[] = [{
      id: "fresh", label: "Fresh Air", kind: "toggle", value: 0, min: 0, max: 1, fill: "#8ad8ff", onChange, onCommit,
    }];
    const { container } = render(<Dial rings={rings} />);
    const svg = svgOf(container);
    expect(screen.getByRole("switch", { name: "Fresh Air" }).getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector(".rotary-encoder-thumb")).toBeNull();
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
    expect(onChange).toHaveBeenCalledWith(1);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it("a toggle flips back from the keyboard", () => {
    const onCommit = vi.fn();
    const rings: RotaryEncoderRing[] = [{
      id: "fresh", label: "Fresh Air", kind: "toggle", value: 1, min: 0, max: 1, onChange: vi.fn(), onCommit,
    }];
    render(<Dial rings={rings} />);
    fireEvent.keyDown(screen.getByRole("switch", { name: "Fresh Air" }), { key: " " });
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("moves a function reading with the drag but still only commits on release", () => {
    const onCommit = vi.fn();
    const rings: RotaryEncoderRing[] = [{
      id: "timer",
      label: "Timer",
      value: 0,
      min: 0,
      max: 100,
      valueText: (value) => `${Math.round(value)} MIN`,
      valueTextWidest: "100 MIN",
      // The caller ignores the preview, as the climate rings do — the reading
      // must still keep up, because the dial owns the live value.
      onChange: () => undefined,
      onCommit,
    }];
    const { container } = render(<Dial rings={rings} />);
    const svg = svgOf(container);
    const reading = () => svg.querySelector(".rotary-encoder-ring-value")?.textContent;

    expect(reading()).toBe("0 MIN");
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, 0) });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, 120) });
    expect(reading()).not.toBe("0 MIN");
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, 120) });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("a slider still fills up to its thumb", () => {
    const rings: RotaryEncoderRing[] = [{ id: "timer", label: "Timer", value: 50, onChange: vi.fn() }];
    const { container } = render(<Dial rings={rings} />);
    expect(container.querySelector(".rotary-encoder-fill")).not.toBeNull();
    expect(container.querySelector(".rotary-encoder-whole-fill")).toBeNull();
  });
});

describe("a ring's value", () => {
  it("is drawn only when the caller passes one", () => {
    const withValue: RotaryEncoderRing[] = [{ id: "timer", label: "Timer", value: 38, valueText: "38 MIN", onChange: vi.fn() }];
    const { container, rerender } = render(<Dial rings={withValue} />);
    expect(container.querySelectorAll(".rotary-encoder-ring-value").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("38 MIN");

    rerender(<Dial rings={[{ id: "timer", label: "Timer", value: 38, onChange: vi.fn() }]} />);
    expect(container.querySelectorAll(".rotary-encoder-ring-value")).toHaveLength(0);
  });

  it("is left off a symmetric ring, whose stops must stay put", () => {
    const rings: RotaryEncoderRing[] = [{
      id: "mode", label: "Mode", kind: "selector", symmetric: true, value: 1, min: 0, max: 2, step: 1, valueText: "FAN", onChange: vi.fn(),
    }];
    const { container } = render(<Dial rings={rings} />);
    expect(container.querySelectorAll(".rotary-encoder-ring-value")).toHaveLength(0);
  });
});

describe("the ring label font", () => {
  it("shrinks on a dial with four or more rings, without moving the rings", () => {
    const three = ringGeometry(200, 3);
    const four = ringGeometry(200, 4);
    expect(three.font).toBe(14);
    // 11px at 200px: the pitch less 6, so neighbouring labels clear each other.
    expect(four.font).toBe(11);
    expect(four.pitch).toBe(three.pitch);
    expect(four.track).toBe(three.track);
  });

  it("never shrinks past the 10px floor", () => {
    for (const size of [100, 120, 150, 200]) {
      expect(ringGeometry(size, 5).font).toBeGreaterThanOrEqual(10);
    }
  });

  it("leaves a dial with three rings or fewer exactly as it was", () => {
    for (const size of [56, 100, 200]) {
      expect(ringGeometry(size, 3).font).toBe(ringLabelFont(size, 3, ringGeometry(size, 3).pitch));
      expect(ringGeometry(size, 3).font).toBe(captionFont(size));
    }
  });
});

describe("shortening a ring to fit its value", () => {
  const geometry = ringGeometry(200, 2);

  it("leaves a ring alone when the label and value already fit", () => {
    expect(ringEndFor(geometry, 0, 20, 20)).toBe(ARC_END);
  });

  it("pulls the end back, and only the end, when they do not", () => {
    const end = ringEndFor(geometry, 0, 160, 90);
    expect(end).toBeLessThan(ARC_END);
    expect(end).toBeGreaterThanOrEqual(ARC_START + ARC_MIN_SPAN);
    // The gap now holds the label, the value and the clearances between them.
    const needed = 160 + 90 + LABEL_VALUE_CLEARANCE * geometry.font + 2 * geometry.track;
    expect(gapLength(geometry, 0, end)).toBeCloseTo(needed, 3);
  });

  it("never shortens past half a turn", () => {
    expect(ringEndFor(geometry, 0, 4000, 4000)).toBe(ARC_START + ARC_MIN_SPAN);
  });

  it("keeps the thumb's travel spanning the shortened arc", () => {
    const half = geometry.thumbHalfAngle[0];
    const end = 90;
    expect(thumbAngle(0, half, end) - half).toBeCloseTo(ARC_START);
    expect(thumbAngle(1, half, end) + half).toBeCloseTo(end);
    expect(fractionAt(thumbAngle(0.4, half, end), half, end)).toBeCloseTo(0.4);
  });
});
