import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RotaryEncoder } from "../../RotaryEncoder";
import { ringAt, ringGeometry } from "../../rotaryEncoderGeometry";
import { CENTRE, Dial, THREE, useDialHarness } from "./RotaryEncoder.fixtures";

useDialHarness();

describe("the lights", () => {
  it("draws as many as it is given and cycles them on a tap", () => {
    const { container } = render(<Dial leds={[{ id: "one", label: "One" }, { id: "two", label: "Two" }]} />);
    expect(container.querySelectorAll(".rotary-encoder-led")).toHaveLength(2);
    const dial = screen.getByRole("slider");
    expect(dial.getAttribute("data-led")).toBe("one");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(dial, { clientX: 51, clientY: 50, pointerId: 1 });
    expect(dial.getAttribute("data-led")).toBe("two");
  });

  it("names every light when asked, and stays unnamed when not", () => {
    const leds = [{ id: "auto", label: "Auto" }, { id: "manual", label: "Manual" }, { id: "off", label: "Off" }];
    const { container, rerender } = render(<Dial leds={leds} />);
    // The colour knob's lights carry no names — its caption names the lit one.
    expect(container.querySelectorAll(".rotary-encoder-led-name")).toHaveLength(0);

    rerender(<Dial leds={leds} ledLabels />);
    const names = [...container.querySelectorAll(".rotary-encoder-led-name")].map((node) => node.textContent);
    expect(names).toEqual(["Auto", "Manual", "Off"]);
    // Every light keeps its own name beside it, not just the lit one.
    expect(container.querySelectorAll(".rotary-encoder-led-slot")).toHaveLength(3);
  });

  it("draws five as readily as three", () => {
    const leds = Array.from({ length: 5 }, (_, index) => ({ id: `l${index}`, label: `L${index}` }));
    const { container } = render(<Dial leds={leds} />);
    expect(container.querySelectorAll(".rotary-encoder-led")).toHaveLength(5);
  });

  it("steps over a light the caller says to skip", () => {
    // An air conditioner with no Auto keeps the light but never lands on it.
    const { container } = render(
      <Dial leds={[{ id: "auto", label: "Auto", skip: true }, { id: "manual", label: "Manual" }, { id: "off", label: "Off" }]} />,
    );
    const dial = screen.getByRole("slider");
    expect(container.querySelectorAll(".rotary-encoder-led")).toHaveLength(3);
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(dial, { clientX: 51, clientY: 50, pointerId: 1 });
    expect(dial.getAttribute("data-led")).toBe("manual");
  });
});

describe("the value's domain", () => {
  it("stops a bounded value at its ends and snaps it to a step", () => {
    const onCommit = vi.fn();
    render(<Dial range={{ min: 16, max: 30, step: 0.5 }} onCommit={onCommit} />);
    const dial = screen.getByRole("slider");
    expect(dial.getAttribute("aria-valuemin")).toBe("16");
    expect(dial.getAttribute("aria-valuemax")).toBe("30");
  });

  it("reports a stepped value in whole steps all the way through a drag", () => {
    // Not only on release: the reading on the knob's face comes from what the
    // caller is handed mid-drag, so an unrounded value there showed a 0.5 step
    // counting in hundredths (Adeline, 2026-09-12).
    const onChange = vi.fn();
    render(<RotaryEncoder leds={THREE} range={{ min: 16, max: 30, step: 0.5 }} value={22} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    // Around the dial's own centre, unlike `at`, which the rings' zero box uses.
    const onDial = (angle: number) => {
      const radians = (angle * Math.PI) / 180;
      return { clientX: CENTRE + 90 * Math.sin(radians), clientY: CENTRE - 90 * Math.cos(radians) };
    };
    fireEvent.pointerDown(dial, { buttons: 1, ...onDial(0), pointerId: 1 });
    for (let step = 1; step <= 12; step += 1) {
      fireEvent.pointerMove(dial, { buttons: 1, ...onDial(step * 5), pointerId: 1 });
    }
    fireEvent.pointerUp(dial, { ...onDial(60), pointerId: 1 });

    // More than one distinct value, so this is really watching the drag and not
    // just the single rounded value the release commits.
    const reported = onChange.mock.calls.map(([value]) => value as number);
    expect(new Set(reported).size).toBeGreaterThan(1);
    for (const value of reported) {
      expect(Math.round(value * 2) / 2).toBeCloseTo(value, 10);
    }
  });

  it("turns a wrapped value forever", () => {
    const onChange = vi.fn();
    render(<RotaryEncoder leds={THREE} range={{ min: 0, max: 360, wrap: true }} value={350} onChange={onChange} />);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: CENTRE, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: CENTRE + 60, clientY: 40, pointerId: 1 });
    expect(onChange.mock.lastCall?.[0]).toBeGreaterThanOrEqual(0);
    expect(onChange.mock.lastCall?.[0]).toBeLessThan(360);
  });
});

describe("what a press lands on", () => {
  const geometry = ringGeometry(200, 3);

  it("keeps the knob to its own disc and gives the colour ring to the first ring", () => {
    // The knob disc is the knob's, and nothing more.
    expect(ringAt(geometry, geometry.knobRadius - 1)).toBeNull();
    // The colour ring and bevel: the knob's before, which is why a press aimed
    // at the innermost ring — even one dead on its thumb — turned the knob.
    expect(ringAt(geometry, geometry.knobRadius + 1)).toBe(0);
    expect(ringAt(geometry, geometry.dialRadius + 1)).toBe(0);
  });

  it("still gives every ring its own track and claims nothing past the last", () => {
    geometry.radii.forEach((radius, index) => {
      expect(ringAt(geometry, radius)).toBe(index);
    });
    expect(ringAt(geometry, geometry.radii[2] + geometry.pitch)).toBeNull();
    // A dial with no rings never takes a press off its knob.
    expect(ringAt(ringGeometry(200, 0), 120)).toBeNull();
  });
});

describe("knob skin", () => {
  afterEach(() => {
    delete document.documentElement.dataset.knobSkin;
  });

  function modeOf(container: HTMLElement) {
    return (container.querySelector(".rotary-encoder") as HTMLElement).dataset.mode;
  }

  it("follows the theme's knob-skin setting with no prop passed", () => {
    document.documentElement.dataset.knobSkin = "light";
    const { container } = render(<Dial />);
    expect(modeOf(container)).toBe("light");
  });

  it("tracks the setting changing under it", async () => {
    document.documentElement.dataset.knobSkin = "light";
    const { container } = render(<Dial />);
    await act(async () => {
      document.documentElement.dataset.knobSkin = "dark";
      await Promise.resolve();
    });
    expect(modeOf(container)).toBe("dark");
  });

  it("lets an explicit prop pin the skin against the setting", () => {
    document.documentElement.dataset.knobSkin = "light";
    const { container } = render(<Dial knobSkin="dark" />);
    expect(modeOf(container)).toBe("dark");
  });

  it("samples the surface when the setting is auto", () => {
    document.documentElement.dataset.knobSkin = "auto";
    const { container } = render(<Dial />);
    expect(modeOf(container)).toBe("dark");
  });
});
