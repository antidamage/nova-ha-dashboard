import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_INTERACTION_COOLDOWN_MS, resetControlInteractionCooldownForTests } from "./controlInteractionCooldown";
import { DotEnvelopeControl, DotLineControl } from "./DotControls";

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
});

describe("DotEnvelopeControl", () => {
  afterEach(cleanup);

  it("shows individual phase durations and keeps equal-time boundaries side by side", () => {
    render(<DotEnvelopeControl ariaLabel="Pulse envelope" max={12} step={0.05} value={[1, 0, 0]} onChange={() => {}} />);

    expect(screen.getByText("1.0s")).toBeInTheDocument();
    expect(screen.getAllByText("0.0s")).toHaveLength(2);
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
