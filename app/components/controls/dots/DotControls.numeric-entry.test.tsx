import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetControlInteractionCooldownForTests } from "../../controlInteractionCooldown";
import {
  DotEnvelopeControl,
  DotLineControl,
} from "../../DotControls";

// A press used to move the value immediately, which left no gesture spare for
// "let me type the number instead". These cover the split: a tap opens the
// field and changes nothing, everything else still drags.
describe("slider numeric entry", () => {
  afterEach(() => {
    cleanup();
    resetControlInteractionCooldownForTests();
  });

  const trackRect = (element: HTMLElement) => {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      bottom: 50, height: 50, left: 0, right: 200, top: 100, width: 200, x: 0, y: 100,
      toJSON: () => ({}),
    });
  };

  const tap = (element: HTMLElement, clientX = 150) => {
    fireEvent.pointerDown(element, { buttons: 1, clientX, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(element, { clientX, clientY: 120, pointerId: 1 });
  };

  it("opens a field on a tap without moving the value", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={1} onChange={onChange} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);

    tap(slider);

    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-valuenow", "20");
    expect(screen.getByRole("dialog", { name: "Test slider" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Test slider" })).toHaveValue("20");
  });

  it("drags instead of opening a field once the pointer has moved", () => {
    const onChange = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={1} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 100, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(slider, { buttons: 1, clientX: 106, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 106, clientY: 120, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores a move smaller than the tap threshold", () => {
    const onChange = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={1} onChange={onChange} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 100, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(slider, { buttons: 1, clientX: 103, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(slider, { clientX: 103, clientY: 120, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("commits a typed value, clamped to the range and snapped to the step", () => {
    const onCommit = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={5} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);
    tap(slider);

    const field = screen.getByRole("textbox", { name: "Test slider" });
    fireEvent.change(field, { target: { value: "500" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenLastCalledWith(100);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps decimals a drag could not comfortably land on", () => {
    const onCommit = vi.fn();
    render(<DotLineControl ariaLabel="Fine slider" value={0.5} min={0} max={1} step={0.01} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);
    tap(slider);

    fireEvent.change(screen.getByRole("textbox", { name: "Fine slider" }), { target: { value: "0.25" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Fine slider" }), { key: "Enter" });

    expect(onCommit).toHaveBeenLastCalledWith(0.25);
  });

  it("leaves the value alone when the field is cancelled", () => {
    const onCommit = vi.fn();
    render(<DotLineControl ariaLabel="Test slider" value={20} min={0} max={100} step={1} onChange={() => {}} onCommit={onCommit} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);
    tap(slider);

    const field = screen.getByRole("textbox", { name: "Test slider" });
    fireEvent.change(field, { target: { value: "77" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuenow", "20");
  });

  it("edits an envelope phase as a duration, not as its cumulative boundary", () => {
    const onCommit = vi.fn();
    render(
      <DotEnvelopeControl ariaLabel="Ramp" max={12} step={0.05} value={[1, 2, 3]} onChange={() => {}} onCommit={onCommit} />,
    );
    const hold = screen.getByRole("slider", { name: "Ramp hold end" });
    trackRect(hold.parentElement as HTMLElement);

    fireEvent.pointerDown(hold, { buttons: 1, clientX: 150, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(hold, { clientX: 150, clientY: 120, pointerId: 1 });

    // The field shows the hold duration, 2s — not the 3s boundary it sits at.
    const field = screen.getByRole("textbox", { name: "Ramp hold" });
    expect(field).toHaveValue("2");
    fireEvent.change(field, { target: { value: "0.5" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenLastCalledWith([1, 0.5, 3]);
  });

  it("stays out of the way of a control that opted out", () => {
    render(<DotLineControl ariaLabel="Stepped" numericEntry={false} value={1} min={0} max={3} step={1} onChange={() => {}} />);
    const slider = screen.getByRole("slider");
    trackRect(slider);

    tap(slider, 100);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
