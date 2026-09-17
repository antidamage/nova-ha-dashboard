import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorEncoder, COLOR_ENCODER_CHANNELS_WITH_ALPHA } from "./ColorEncoder";
import { at, Controlled, degreesFor, start, tap, turn, useDialHarness } from "./ColorEncoder.fixtures";

useDialHarness();

describe("ColorEncoder", () => {
  it("ignores an incoming value while the drag is still in the hand", () => {
    // A zone reporting a waypoint of a fade must not yank a turn in progress.
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorEncoder activeChannel="brightness" value={{ ...start, v: 90 }} onChange={onChange} />,
    );
    const dial = screen.getByRole("slider");
    fireEvent.pointerDown(dial, { buttons: 1, ...at(0), pointerId: 1 });
    fireEvent.pointerMove(dial, { buttons: 1, ...at(degreesFor(30)), pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBeCloseTo(100, 5);

    // Mid-drag echo of a much lower brightness: ignored.
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 12 }} onChange={onChange} />);
    fireEvent.pointerMove(dial, { buttons: 1, ...at(degreesFor(40)), pointerId: 1 });
    expect(onChange.mock.lastCall?.[0].v).toBe(100);
    expect(dial.getAttribute("aria-valuenow")).toBe("100");

    // Once the gesture is over, a genuine outside change is taken.
    fireEvent.pointerUp(dial, { ...at(degreesFor(40)), pointerId: 1 });
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 12 }} onChange={onChange} />);
    expect(dial.getAttribute("aria-valuenow")).toBe("12");
  });

  it("commits once per gesture, and a tap commits nothing", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<ColorEncoder value={start} onChange={onChange} onCommit={onCommit} />);
    const dial = screen.getByRole("slider");
    tap(dial);
    expect(onCommit).not.toHaveBeenCalled();
    turn(dial, 12);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  const angleOf = (container: HTMLElement) =>
    (container.querySelector(".color-encoder") as HTMLElement).style.getPropertyValue("--re-angle");

  it("points the index at the value: 0 at 7:30, 50 at 12, 100 at 4:30, over the top", () => {
    for (const [v, expected] of [[0, "-135.00deg"], [50, "0.00deg"], [100, "135.00deg"], [20, "-81.00deg"]] as const) {
      const { container, unmount } = render(
        <ColorEncoder activeChannel="brightness" value={{ ...start, v }} onChange={vi.fn()} />,
      );
      expect(angleOf(container)).toBe(expected);
      unmount();
    }
  });

  it("points at hue as degrees", () => {
    const { container } = render(<ColorEncoder value={start} onChange={vi.fn()} />);
    expect(angleOf(container)).toBe("200.00deg");
  });

  it("re-points the index on a channel change, the short way round", () => {
    // Hue 200 (south-south-west), brightness 50 (12 o'clock), saturation 100 (4:30).
    const { container } = render(<ColorEncoder value={{ h: 200, s: 100, v: 50, a: 100 }} onChange={vi.fn()} />);
    const dial = screen.getByRole("slider");
    expect(angleOf(container)).toBe("200.00deg");
    tap(dial);
    // 0° is 160° from 200° going clockwise, 200° going back: clockwise to 360.
    expect(angleOf(container)).toBe("360.00deg");
    tap(dial);
    expect(angleOf(container)).toBe("495.00deg");
    tap(dial);
    // Back on hue: 200° is nearest 495° at 560°.
    expect(angleOf(container)).toBe("560.00deg");
  });

  it("tracks the drag 1:1 and sweeps over the top on a big outside change", () => {
    const { container, rerender } = render(
      <ColorEncoder activeChannel="brightness" value={{ ...start, v: 0 }} onChange={vi.fn()} />,
    );
    expect(angleOf(container)).toBe("-135.00deg");
    // 0 → 100 from outside must go through 12 o'clock, not under the bottom.
    rerender(<ColorEncoder activeChannel="brightness" value={{ ...start, v: 100 }} onChange={vi.fn()} />);
    expect(angleOf(container)).toBe("135.00deg");
  });

  it("stops the index when a clamped channel hits its end, and moves again on reversal", () => {
    const { container } = render(<Controlled activeChannel="saturation" initial={{ ...start, s: 95 }} />);
    const dial = screen.getByRole("slider");
    turn(dial, degreesFor(20));
    expect(dial.getAttribute("aria-valuenow")).toBe("100");
    expect(angleOf(container)).toBe("135.00deg");
    // Turning further past the end moves nothing.
    turn(dial, degreesFor(20));
    expect(angleOf(container)).toBe("135.00deg");
    // Reversing moves value and index at once — no wind-back through the overshoot.
    turn(dial, -degreesFor(10));
    expect(dial.getAttribute("aria-valuenow")).toBe("90");
    expect(angleOf(container)).toBe("108.00deg");
  });

  it("stops at zero too, for brightness and alpha", () => {
    for (const channel of ["brightness", "alpha"] as const) {
      const { container, unmount } = render(
        <Controlled channels={COLOR_ENCODER_CHANNELS_WITH_ALPHA} activeChannel={channel} initial={{ ...start, v: 3, a: 3 }} />,
      );
      turn(screen.getByRole("slider"), -degreesFor(20));
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("0");
      expect(angleOf(container)).toBe("-135.00deg");
      unmount();
    }
  });

  it("turns forever on hue, continuous across 360", () => {
    const { container } = render(<Controlled initial={start} />);
    turn(screen.getByRole("slider"), 500);
    // +500° of hue from 200°: the index has gone round, not snapped back to 340°.
    expect(angleOf(container)).toBe("700.00deg");
    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("340");
  });

  it("glows only from half brightness up", () => {
    const { container, rerender } = render(<ColorEncoder value={{ ...start, v: 49 }} onChange={vi.fn()} />);
    const root = container.querySelector(".color-encoder") as HTMLElement;
    expect(root.style.getPropertyValue("--re-glow")).toBe("0 0 0 rgba(0, 0, 0, 0)");
    rerender(<ColorEncoder value={{ ...start, v: 100 }} onChange={vi.fn()} />);
    expect(root.style.getPropertyValue("--re-glow")).toMatch(/px rgba\(/);
  });
});
