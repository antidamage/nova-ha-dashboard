import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SMOOTH_SCROLL_CHANGE_EVENT,
  SMOOTH_SCROLL_STORAGE_KEY,
  readSmoothScrollSetting,
  writeSmoothScrollSetting,
} from "./smoothScrollSetting";
import { dampingAlpha } from "./useSmoothWheelScroll";

// Storage contract for the per-device smooth-scroll preference. Like the other
// per-device settings this is a browser-local boolean under one localStorage
// key. Default (unset) is ON; only an explicit "false" opts out.
describe("smooth scroll setting", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to on when unset", () => {
    expect(readSmoothScrollSetting()).toBe(true);
  });

  it("round-trips an explicit off/on", () => {
    writeSmoothScrollSetting(false);
    expect(window.localStorage.getItem(SMOOTH_SCROLL_STORAGE_KEY)).toBe("false");
    expect(readSmoothScrollSetting()).toBe(false);

    writeSmoothScrollSetting(true);
    expect(readSmoothScrollSetting()).toBe(true);
  });

  it("treats any non-\"false\" stored value as on", () => {
    window.localStorage.setItem(SMOOTH_SCROLL_STORAGE_KEY, "garbage");
    expect(readSmoothScrollSetting()).toBe(true);
  });

  it("dispatches the change event on write so same-tab hooks re-sync", () => {
    const listener = vi.fn();
    window.addEventListener(SMOOTH_SCROLL_CHANGE_EVENT, listener);
    writeSmoothScrollSetting(false);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SMOOTH_SCROLL_CHANGE_EVENT, listener);
  });
});

describe("low-frame-rate damping", () => {
  it("advances equally over the same wall time regardless of frame rate", () => {
    const speed = 0.18;
    const oneSixtieth = dampingAlpha(speed, 1000 / 60);
    const oneThirtieth = dampingAlpha(speed, 1000 / 30);
    expect(oneThirtieth).toBeCloseTo(1 - (1 - oneSixtieth) ** 2, 10);
  });
});
