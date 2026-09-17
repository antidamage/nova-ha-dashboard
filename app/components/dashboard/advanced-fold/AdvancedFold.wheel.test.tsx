import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFoldGeometry } from "../advancedFoldTesting";
import { drag, matchWide, renderFold } from "./AdvancedFold.fixtures";

describe("AdvancedFold", () => {
  beforeEach(() => {
    matchWide(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("counts the wheel at a quarter: three 100px notches stay closed, four open", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);

    for (let i = 0; i < 3; i += 1) expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(false);
    expect(fold.dataset.open).toBe("false");
    act(() => {
      vi.advanceTimersByTime(450);
    });

    for (let i = 0; i < 3; i += 1) fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
    fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollTop).toBe(100);
  });

  it("lets the pull decay when the wheel stops for 400ms", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    fireEvent.wheel(fold, { deltaY: 100 });
    fireEvent.wheel(fold, { deltaY: 100 });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    fireEvent.wheel(fold, { deltaY: 100 });
    fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
  });

  it("judges the wheel's pause by event time, not by a timer a busy page ran early", () => {
    vi.useFakeTimers();
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    const wheelAt = (time: number) => act(() => {
      const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
      Object.defineProperty(event, "timeStamp", { value: time });
      fold.dispatchEvent(event);
    });

    wheelAt(10_000);
    wheelAt(10_100);
    // The timer runs before the next notch, which was queued 100ms later.
    act(() => {
      vi.advanceTimersByTime(450);
    });
    wheelAt(10_200);
    expect(fold.dataset.open).toBe("false");
    wheelAt(10_300);
    expect(fold.dataset.open).toBe("true");
  });

  it("runs sideways in portrait and ignores a vertical wheel there", () => {
    matchWide(false);
    const { fold } = renderFold();
    fakeFoldGeometry(fold);
    expect(fold.dataset.axis).toBe("x");

    for (let i = 0; i < 6; i += 1) expect(fireEvent.wheel(fold, { deltaY: 100 })).toBe(true);
    expect(fold.dataset.open).toBe("false");

    drag(fold, 180, "x");
    expect(fold.dataset.open).toBe("true");
    expect(fold.scrollLeft).toBe(180);
  });

  it("lets the band go after a wheel break with nothing to open onto", () => {
    vi.useFakeTimers();
    const { fold, track } = renderFold();
    fakeFoldGeometry(fold, { advanced: 0 });

    for (let i = 0; i < 4; i += 1) fireEvent.wheel(fold, { deltaY: 100 });
    expect(fold.dataset.open).toBe("false");
    expect(track!.style.transform).not.toBe("");
    expect(track!.style.transform).not.toBe("none");

    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(fold.dataset.open).toBe("false");
    expect(["", "none"]).toContain(track!.style.transform);
  });
});
