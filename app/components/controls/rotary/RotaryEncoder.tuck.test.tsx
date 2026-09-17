import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RotaryEncoder, TUCK_RING_MS, TUCK_RING_STAGGER_MS, type RotaryEncoderRing } from "../../RotaryEncoder";
import { CENTRE, Dial, THREE, svgOf, useDialHarness } from "./RotaryEncoder.fixtures";

useDialHarness();

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

describe("hidden rings", () => {
  const RINGS: RotaryEncoderRing[] = [
    { id: "mode", label: "Mode", value: 1, min: 0, max: 2, step: 1, onChange: () => undefined },
    { id: "fan", label: "Fan", value: 1, min: 0, max: 3, step: 1, onChange: () => undefined },
    { id: "timer", label: "Timer", value: 30, min: 0, max: 120, step: 15, onChange: () => undefined },
  ];

  function ringsOf(container: HTMLElement) {
    return [...svgOf(container).querySelectorAll(".rotary-encoder-ring-slider")] as SVGGElement[];
  }

  /** One deliberate tap on the dial, which unlocks it and shows the rings. */
  function open() {
    let time = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, clientX: 40, clientY: 40, pointerId: 1 });
    time += 120;
    fireEvent.pointerUp(dial, { clientX: 40, clientY: 40, pointerId: 1 });
  }

  it("keeps a hidden ring in the stack so the rest do not change radius", () => {
    const { container, rerender } = render(<Dial rings={RINGS} tuckAfterMs={5000} />);
    act(() => open());
    const before = ringsOf(container).map((ring) => ring.dataset.ringId);
    rerender(<Dial rings={RINGS.map((ring) => (ring.id === "timer" ? ring : { ...ring, hidden: true }))} tuckAfterMs={5000} />);
    expect(ringsOf(container).map((ring) => ring.dataset.ringId)).toEqual(before);
  });

  it("tucks a hidden ring away and takes it out of reach", async () => {
    const { container } = render(
      <Dial rings={RINGS.map((ring) => (ring.id === "fan" ? { ...ring, hidden: true } : ring))} tuckAfterMs={5000} />,
    );
    act(() => open());
    // Two frames for the open transition's start state, or every ring still
    // reads as tucked (`entering`).
    await act(async () => { await new Promise((done) => setTimeout(done, 60)); });
    const fan = ringsOf(container).find((ring) => ring.dataset.ringId === "fan")!;
    const timer = ringsOf(container).find((ring) => ring.dataset.ringId === "timer")!;
    expect(fan.dataset.hidden).toBe("true");
    expect(fan.style.opacity).toBe("0");
    expect(fan.style.transform.startsWith("scale(")).toBe(true);
    expect(fan.style.pointerEvents).toBe("none");
    expect(fan.getAttribute("tabindex")).toBe("-1");
    expect(fan.getAttribute("aria-hidden")).toBe("true");
    // Its neighbour is untouched.
    expect(timer.dataset.hidden).toBeUndefined();
    expect(timer.style.opacity).toBe("1");
  });

  it("takes no keyboard input while hidden", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Dial rings={[{ ...RINGS[0], hidden: true, onChange }]} tuckAfterMs={5000} />,
    );
    act(() => open());
    fireEvent.keyDown(ringsOf(container)[0], { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops the blocker when every ring is folded away", () => {
    const { container } = render(<Dial rings={RINGS.map((ring) => ({ ...ring, hidden: true }))} tuckAfterMs={5000} />);
    act(() => open());
    expect(svgOf(container).querySelector("[data-testid='rotary-encoder-blocker']")).toBeNull();
  });

  it("keeps the blocker while one ring is still on show", () => {
    const { container } = render(
      <Dial rings={RINGS.map((ring) => (ring.id === "timer" ? ring : { ...ring, hidden: true }))} tuckAfterMs={5000} />,
    );
    act(() => open());
    expect(svgOf(container).querySelector("[data-testid='rotary-encoder-blocker']")).not.toBeNull();
  });
});
