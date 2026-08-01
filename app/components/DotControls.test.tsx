import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_INTERACTION_COOLDOWN_MS, resetControlInteractionCooldownForTests } from "./controlInteractionCooldown";
import { DotEnvelopeControl, DotLineControl, precisionDragScale } from "./DotControls";

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
});
