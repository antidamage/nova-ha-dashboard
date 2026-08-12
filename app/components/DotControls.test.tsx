import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_INTERACTION_COOLDOWN_MS, resetControlInteractionCooldownForTests } from "./controlInteractionCooldown";
import {
  DotEnvelopeControl,
  DotLineControl,
  DotRangeControl,
  DotSpectrumControl,
  precisionDragScale,
} from "./DotControls";

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

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 150, clientY: 25, pointerId: 1 });
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

describe("DotEnvelopeControl", () => {
  afterEach(cleanup);

  it("shows individual phase durations and keeps equal-time boundaries side by side", () => {
    render(<DotEnvelopeControl ariaLabel="Pulse envelope" max={12} step={0.05} value={[1, 0, 0]} onChange={() => {}} />);

    expect(screen.getByText("1.0s")).toBeInTheDocument();
    expect(screen.getAllByText("0.0s")).toHaveLength(2);
    expect(screen.getByText("ATK")).toBeInTheDocument();
    expect(screen.getByText("HLD")).toBeInTheDocument();
    expect(screen.getByText("REL")).toBeInTheDocument();
    const attack = screen.getByRole("slider", { name: "Pulse envelope attack end" });
    const hold = screen.getByRole("slider", { name: "Pulse envelope hold end" });
    const release = screen.getByRole("slider", { name: "Pulse envelope release end" });
    expect(attack).toHaveAttribute("aria-valuenow", "1");
    expect(hold).toHaveAttribute("aria-valuenow", "1");
    expect(release).toHaveAttribute("aria-valuenow", "1");
    expect(hold.style.left).not.toBe(attack.style.left);
    expect(release.style.left).not.toBe(hold.style.left);
  });

  // The thumbs push rather than block, and only ever rightwards: the three
  // boundaries are cumulative, so moving attack must not silently rewrite the
  // phases after it.
  describe("pushing thumbs", () => {
    const renderEnvelope = (value: [number, number, number]) => {
      const onChange = vi.fn();
      render(<DotEnvelopeControl ariaLabel="Envelope" max={12} step={0.05} value={value} onChange={onChange} />);
      return {
        attack: screen.getByRole("slider", { name: "Envelope attack end" }),
        hold: screen.getByRole("slider", { name: "Envelope hold end" }),
        onChange,
        release: screen.getByRole("slider", { name: "Envelope release end" }),
      };
    };

    it("carries hold and release along when attack moves", () => {
      const { attack, onChange } = renderEnvelope([1, 2, 3]);

      // A 0.05 step still moves by the finest decimal it expresses, 0.01.
      fireEvent.keyDown(attack, { key: "ArrowRight" });
      expect(onChange).toHaveBeenLastCalledWith([1.01, 2, 3]);

      fireEvent.keyDown(attack, { key: "ArrowLeft" });
      expect(onChange).toHaveBeenLastCalledWith([0.99, 2, 3]);
    });

    it("shrinks the carried phases rather than pushing them off the end", () => {
      const { attack, onChange } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(attack, { key: "End" });

      expect(onChange).toHaveBeenLastCalledWith([12, 0, 0]);
    });

    it("stops hold against attack without moving it, and carries release", () => {
      const { hold, onChange } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(hold, { key: "Home" });
      expect(onChange).toHaveBeenLastCalledWith([1, 0, 3]);

      fireEvent.keyDown(hold, { key: "End" });
      expect(onChange).toHaveBeenLastCalledWith([1, 11, 0]);
    });

    it("lets release be pushed by hold but never push it back", () => {
      const { onChange, release } = renderEnvelope([1, 2, 3]);

      fireEvent.keyDown(release, { key: "Home" });
      expect(onChange).toHaveBeenLastCalledWith([1, 2, 0]);

      fireEvent.keyDown(release, { key: "End" });
      expect(onChange).toHaveBeenLastCalledWith([1, 2, 9]);
    });
  });
});

describe("DotRangeControl", () => {
  afterEach(cleanup);

  it("pushes the other thumb along instead of blocking against it", () => {
    const onChange = vi.fn();
    render(
      <DotRangeControl ariaLabel="Range" min={0} max={100} step={1} value={[20, 50]} onChange={onChange} />,
    );

    fireEvent.keyDown(screen.getByRole("slider", { name: "Range minimum" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith([100, 100]);

    fireEvent.keyDown(screen.getByRole("slider", { name: "Range maximum" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith([0, 0]);
  });
});
