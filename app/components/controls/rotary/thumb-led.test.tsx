import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type RotaryEncoderRing } from "../../RotaryEncoder";
import { THUMB_LED_LINE_PX } from "./constants";
import { ringGeometry, thumbAngle } from "./geometry-model";
import { Dial, at, svgOf, useDialHarness } from "./RotaryEncoder.fixtures";
import { thumbHasGroove, thumbLed } from "./thumb-led-model";

useDialHarness();

// specs/color-encoder.md, "The thumb's LED line".
describe("the thumb's LED line state", () => {
  const base = { kind: "slider" as const, fraction: 0.5, fill: null, disabled: false, grabbed: false };

  it("is lit while a slider's track carries a fill, and dark at its minimum", () => {
    expect(thumbLed(base)).toBe("lit");
    expect(thumbLed({ ...base, fraction: 0 })).toBe("dark");
  });

  it("follows a selector's fill", () => {
    expect(thumbLed({ ...base, kind: "selector", fill: "#ff4a1c" })).toBe("lit");
    expect(thumbLed({ ...base, kind: "selector", fill: null })).toBe("dark");
  });

  it("glows while grabbed, the minimum included, and never on a disabled ring", () => {
    expect(thumbLed({ ...base, grabbed: true })).toBe("grabbed");
    expect(thumbLed({ ...base, fraction: 0, grabbed: true })).toBe("grabbed");
    expect(thumbLed({ ...base, disabled: true })).toBe("dark");
    expect(thumbLed({ ...base, disabled: true, grabbed: true })).toBe("dark");
  });

  it("has room for its groove on the thinnest thumb the track floor allows", () => {
    for (let size = 50; size <= 200; size += 1) {
      expect(thumbHasGroove(1.3 * ringGeometry(size, 1).track)).toBe(true);
    }
  });
});

describe("the thumb's LED line on a dial", () => {
  const geometry = ringGeometry(200, 1);
  const radius = geometry.radii[0];
  const timer = (value: number, extra: Partial<RotaryEncoderRing> = {}): RotaryEncoderRing[] => [
    { id: "timer", label: "Timer", value, min: 0, max: 480, step: 2, onChange: vi.fn(), ...extra },
  ];
  const thumb = (container: HTMLElement) => svgOf(container).querySelector(".rotary-encoder-thumb");

  it("draws a 2px line in a groove on the thumb", () => {
    const { container } = render(<Dial rings={timer(60)} />);
    const line = svgOf(container).querySelector(".rotary-encoder-thumb-led");
    expect(line?.getAttribute("stroke-width")).toBe(String(THUMB_LED_LINE_PX));
    expect(svgOf(container).querySelector(".rotary-encoder-thumb-groove")).not.toBeNull();
  });

  it("is dark with the timer at zero, lit once it is set, dark when disabled", () => {
    const { container, rerender } = render(<Dial rings={timer(0)} />);
    expect(thumb(container)?.getAttribute("data-led")).toBe("dark");
    rerender(<Dial rings={timer(60)} />);
    expect(thumb(container)?.getAttribute("data-led")).toBe("lit");
    rerender(<Dial rings={timer(60, { disabled: true })} />);
    expect(thumb(container)?.getAttribute("data-led")).toBe("dark");
  });

  it("glows while its thumb is held and goes back on release", () => {
    const { container } = render(<Dial rings={timer(0)} />);
    const svg = svgOf(container);
    fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, thumbAngle(0, geometry.thumbHalfAngle[0])) });
    expect(thumb(container)?.getAttribute("data-led")).toBe("grabbed");
    fireEvent.pointerUp(svg, { pointerId: 1, ...at(radius, thumbAngle(0, geometry.thumbHalfAngle[0])) });
    expect(thumb(container)?.getAttribute("data-led")).toBe("dark");
  });

  it("is dark on a disabled dial, whatever the ring's value", () => {
    const { container } = render(<Dial rings={timer(60)} disabled />);
    expect(thumb(container)?.getAttribute("data-led")).toBe("dark");
  });
});
