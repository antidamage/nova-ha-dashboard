import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_INTERACTION_COOLDOWN_MS, resetControlInteractionCooldownForTests } from "./controlInteractionCooldown";
import { DotLineControl } from "./DotControls";

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
