// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFF_SCREEN_GRACE_MS } from "./constants";
import { useOnScreen } from "./useOnScreen";

let report: (isIntersecting: boolean) => void = () => {};

class FakeObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    report = (isIntersecting) => callback([{ isIntersecting }]);
  }
  observe() {}
  disconnect() {}
}

const hook = () => renderHook(() => useOnScreen({ current: document.createElement("div") })).result;

describe("useOnScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is off until measured, and on as soon as it comes into view", () => {
    const result = hook();
    expect(result.current).toBe(false);
    act(() => report(true));
    expect(result.current).toBe(true);
  });

  it("stays on through the grace period after leaving", () => {
    const result = hook();
    act(() => report(true));
    act(() => report(false));
    act(() => { vi.advanceTimersByTime(OFF_SCREEN_GRACE_MS - 1); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(false);
  });

  it("does not stop for a scroll that comes back within the grace period", () => {
    const result = hook();
    act(() => report(true));
    act(() => report(false));
    act(() => { vi.advanceTimersByTime(OFF_SCREEN_GRACE_MS - 1); });
    act(() => report(true));
    act(() => { vi.advanceTimersByTime(OFF_SCREEN_GRACE_MS * 2); });
    expect(result.current).toBe(true);
  });

  it("counts a hidden page as off-screen", () => {
    const result = hook();
    act(() => report(true));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    act(() => { vi.advanceTimersByTime(OFF_SCREEN_GRACE_MS); });
    expect(result.current).toBe(false);
    visibility.mockRestore();
  });

  it("treats a browser with no observer as on-screen", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(hook().current).toBe(true);
  });
});
