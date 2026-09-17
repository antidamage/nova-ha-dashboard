import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_INTERACTION_COOLDOWN_MS, resetControlInteractionCooldownForTests } from "../../controlInteractionCooldown";
import {
  DotLineControl,
  DotSpectrumControl,
  precisionDragScale,
} from "../../DotControls";
import { TAP_MAX_MS } from "../../sliderTapGesture";

describe("precision drag scaling", () => {
  it("keeps full speed in the dead zone and reaches quarter speed at 100 pixels", () => {
    expect(precisionDragScale(0)).toBe(1);
    expect(precisionDragScale(30)).toBe(1);
    expect(precisionDragScale(-30)).toBe(1);
    expect(precisionDragScale(100)).toBe(0.25);
    expect(precisionDragScale(-100)).toBe(0.25);
    expect(precisionDragScale(200)).toBe(0.25);
  });
});

describe("DotLineControl reconciliation hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "lite");
    resetControlInteractionCooldownForTests();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetControlInteractionCooldownForTests();
    vi.useRealTimers();
  });

  it("ignores stale prop updates while dragging and for six seconds after release", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const view = render(
      <DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={1} onChange={onChange} onCommit={onCommit} />,
    );
    const slider = screen.getByRole("slider");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 50, height: 50, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });

    // A press no longer moves the value on its own — that gesture belongs to
    // numeric entry now. Holding still past the tap window promotes it to a
    // drag, which applies the press at the coordinates it happened at.
    fireEvent.pointerDown(slider, { buttons: 1, clientX: 150, clientY: 25, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "20");
    act(() => vi.advanceTimersByTime(TAP_MAX_MS));
    expect(slider).toHaveAttribute("aria-valuenow", "75");

    view.rerender(
      <DotLineControl ariaLabel="Test slider" value={10} min={0} max={100} step={1} onChange={onChange} onCommit={onCommit} />,
    );
    expect(slider).toHaveAttribute("aria-valuenow", "75");

    fireEvent.pointerUp(slider, { clientX: 150, clientY: 25, pointerId: 1 });
    expect(onCommit).toHaveBeenLastCalledWith(75);

    act(() => vi.advanceTimersByTime(CONTROL_INTERACTION_COOLDOWN_MS - 1));
    expect(slider).toHaveAttribute("aria-valuenow", "75");

    act(() => vi.advanceTimersByTime(1));
    expect(slider).toHaveAttribute("aria-valuenow", "10");
  });

  it("accumulates full-speed and quarter-speed movement without rescaling earlier movement", () => {
    const onChange = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={50} min={0} max={100} step={1} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({
      bottom: 50, height: 50, left: 0, right: 200, top: 0, width: 200, x: 0, y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 100, clientY: 25, pointerId: 1 });
    fireEvent.pointerMove(slider, { buttons: 1, clientX: 140, clientY: 25, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "70");

    fireEvent.pointerMove(slider, { buttons: 1, clientX: 140, clientY: 150, pointerId: 1 });
    expect(slider).toHaveAttribute("aria-valuenow", "70");

    fireEvent.pointerMove(slider, { buttons: 1, clientX: 180, clientY: 150, pointerId: 1 });

    expect(onChange).toHaveBeenLastCalledWith(75);
    expect(slider).toHaveAttribute("aria-valuenow", "75");
  });

  it("uses the full precision expressed by a decimal step", () => {
    const onChange = vi.fn();
    render(<DotLineControl ariaLabel="Fine slider" value={0.005} min={0} max={0.01} step={0.005} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });

    expect(onChange).toHaveBeenLastCalledWith(0.006);
  });
});

describe("DotLineControl snapRemote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00Z"));
    // Full experience mode: lite already snaps, so the easing path is only
    // reachable — and this prop only meaningful — here.
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "full");
    resetControlInteractionCooldownForTests();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    resetControlInteractionCooldownForTests();
    vi.useRealTimers();
  });

  it("takes an incoming value whole instead of easing the thumb toward it", () => {
    const view = render(
      <DotLineControl ariaLabel="Snapping slider" max={100} min={0} snapRemote step={1} value={20} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "20");

    view.rerender(
      <DotLineControl ariaLabel="Snapping slider" max={100} min={0} snapRemote step={1} value={80} onChange={vi.fn()} />,
    );

    // No animation frames have run, so an eased control would still be at 20.
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "80");
  });

  it("still eases when the prop is not set, so other sliders keep their glide", () => {
    const view = render(
      <DotLineControl ariaLabel="Easing slider" max={100} min={0} step={1} value={20} onChange={vi.fn()} />,
    );

    view.rerender(
      <DotLineControl ariaLabel="Easing slider" max={100} min={0} step={1} value={80} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "20");
  });
});

describe("DotSpectrumControl remote cursor panning", () => {
  beforeEach(() => {
    window.localStorage.setItem("nova.dashboard.experienceMode.v1", "full");
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("pans toward an incoming cursor without ever writing back to the lights", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const rgbAtPosition = () => [255, 180, 90] as [number, number, number];
    const view = render(
      <DotSpectrumControl
        ariaLabel="Zone color spectrum"
        cursor={{ x: 0.1, y: 0.2 }}
        rgbAtPosition={rgbAtPosition}
        onChange={onChange}
        onCommit={onCommit}
      />,
    );

    // Colour readings arriving mid-fade move the dot — that pan is allowed —
    // but panning is display only: it must never issue a light command, or the
    // dashboard would drive the lights from its own animation.
    for (const cursor of [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.55 }, { x: 0.62, y: 0.61 }]) {
      view.rerender(
        <DotSpectrumControl
          ariaLabel="Zone color spectrum"
          cursor={cursor}
          rgbAtPosition={rgbAtPosition}
          onChange={onChange}
          onCommit={onCommit}
        />,
      );
    }

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
