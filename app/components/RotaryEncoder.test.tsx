import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RotaryEncoder, TUCK_RING_MS, TUCK_RING_STAGGER_MS, type RotaryEncoderRing } from "./RotaryEncoder";
import {
  ARC_END,
  ARC_START,
  ARC_MIN_SPAN,
  LABEL_VALUE_CLEARANCE,
  ringEndFor,
  ringGeometry,
  thumbAngle,
  fractionAt,
  gapLength,
} from "./rotaryEncoderGeometry";

/** The 200px dial's box: the footprint is 1.244 knob diameters. */
const DIAL_BOX = 248.8;
const CENTRE = DIAL_BOX / 2;

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

/** jsdom lays nothing out, so the rings' SVG is a zero box at the origin. */
function at(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { clientX: radius * Math.sin(radians), clientY: -radius * Math.cos(radians) };
}

function svgOf(container: HTMLElement) {
  const svg = (container.ownerDocument ?? document).querySelector("svg.rotary-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg as SVGSVGElement;
}

const THREE = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

function Dial({ leds = THREE, ...props }: Partial<React.ComponentProps<typeof RotaryEncoder>> = {}) {
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

describe("tuck-away", () => {
  const rings: RotaryEncoderRing[] = [
    { id: "one", label: "One", value: 10, onChange: vi.fn() },
    { id: "two", label: "Two", value: 20, onChange: vi.fn() },
  ];

  /** A press and release `held` ms apart, `moved` px away. */
  function tap(dial: HTMLElement, held: number, moved = 0, clock?: { advance: (ms: number) => void }) {
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
    clock?.advance(held);
    if (moved) {
      fireEvent.pointerMove(dial, { buttons: 1, clientX: 40 + moved, clientY: 40, pointerId: 1 });
    }
    fireEvent.pointerUp(dial, { clientX: 40 + moved, clientY: 40, pointerId: 1 });
  }

  function clock() {
    let time = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    return { advance: (ms: number) => { time += ms; } };
  }

  it("starts locked, with its rings folded away", () => {
    vi.useFakeTimers();
    const { container } = render(<Dial rings={rings} tuckAfterMs={5000} />);
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("true");
    // The rings stay mounted for the collapse, then leave.
    act(() => vi.advanceTimersByTime(TUCK_RING_MS + TUCK_RING_STAGGER_MS + 50));
    expect(document.querySelector("svg.rotary-encoder-rings")).toBeNull();
  });

  it("opens on one deliberate tap", () => {
    vi.useFakeTimers();
    const time = clock();
    const { container } = render(<Dial rings={rings} tuckAfterMs={5000} />);
    tap(screen.getByRole("slider"), 120, 0, time);
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("false");
  });

  it("ignores a brush, a long hold and a drag", () => {
    vi.useFakeTimers();
    const time = clock();
    const { container } = render(<Dial rings={rings} tuckAfterMs={5000} />);
    const dial = screen.getByRole("slider");
    const locked = () => container.querySelector(".rotary-encoder")?.getAttribute("data-locked");

    tap(dial, 20, 0, time);
    expect(locked()).toBe("true");
    tap(dial, 900, 0, time);
    expect(locked()).toBe("true");
    tap(dial, 120, 40, time);
    expect(locked()).toBe("true");
  });

  it("locks itself again after the quiet spell", () => {
    vi.useFakeTimers();
    const time = clock();
    const { container } = render(<Dial rings={rings} tuckAfterMs={5000} />);
    tap(screen.getByRole("slider"), 120, 0, time);
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("false");
    act(() => vi.advanceTimersByTime(4999));
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("false");
    act(() => vi.advanceTimersByTime(2));
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("true");
  });

  it("locks at once when a tap lands somewhere else", () => {
    vi.useFakeTimers();
    const time = clock();
    const { container } = render(<Dial rings={rings} tuckAfterMs={5000} />);
    tap(screen.getByRole("slider"), 120, 0, time);
    fireEvent.pointerDown(document.body, { buttons: 1, pointerId: 2 });
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBe("true");
  });

  it("takes no turn while locked", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <RotaryEncoder leds={THREE} range={{ min: 0, max: 100 }} value={50} onChange={onChange} rings={rings} tuckAfterMs={5000} />,
    );
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: CENTRE, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, clientX: CENTRE + 80, clientY: 60, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("floats its rings over the page, with a blocker behind them", () => {
    vi.useFakeTimers();
    const time = clock();
    render(<Dial rings={rings} tuckAfterMs={5000} />);
    tap(screen.getByRole("slider"), 120, 0, time);
    const layer = document.body.querySelector(".rotary-encoder-ring-layer");
    expect(layer).not.toBeNull();
    expect(layer?.querySelector("svg.rotary-encoder-rings")).not.toBeNull();
    expect(layer?.querySelector('[data-testid="rotary-encoder-blocker"]')).not.toBeNull();
  });

  it("does not float or lock a dial without tuck-away", () => {
    const { container } = render(<Dial rings={rings} />);
    expect(container.querySelector(".rotary-encoder")?.getAttribute("data-locked")).toBeNull();
    expect(document.body.querySelector(".rotary-encoder-ring-layer")).toBeNull();
    expect(container.querySelector("svg.rotary-encoder-rings")).not.toBeNull();
  });
});
