import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSelfRotatingByAgent,
  isSensorReading,
  SENSOR_PROBE_MS,
  useAutoRotatingDevice,
} from "./autoRotationSensing";

const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

function Probe({ onValue }: { onValue: (value: boolean) => void }) {
  onValue(useAutoRotatingDevice());
  return null;
}

describe("isSelfRotatingByAgent", () => {
  it("treats a plain desktop as not self-rotating", () => {
    expect(isSelfRotatingByAgent({ userAgent: DESKTOP, maxTouchPoints: 0 })).toBe(false);
  });

  it("treats a touch desktop kiosk as not self-rotating", () => {
    expect(isSelfRotatingByAgent({ userAgent: DESKTOP, maxTouchPoints: 10 })).toBe(false);
  });

  it("catches phones, tablets and iPadOS posing as a Mac", () => {
    expect(isSelfRotatingByAgent({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(true);
    expect(isSelfRotatingByAgent({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toBe(true);
    expect(isSelfRotatingByAgent({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isSelfRotatingByAgent({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
  });

  it("trusts userAgentData.mobile", () => {
    expect(isSelfRotatingByAgent({ userAgent: DESKTOP, userAgentData: { mobile: true } })).toBe(true);
  });
});

describe("isSensorReading", () => {
  it("is false for the nulls a desktop browser reports and true for numbers", () => {
    expect(isSensorReading({ beta: null, gamma: null })).toBe(false);
    expect(isSensorReading({ beta: 0, gamma: null })).toBe(true);
    expect(isSensorReading({ beta: null, gamma: -12.5 })).toBe(true);
  });
});

describe("useAutoRotatingDevice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(DESKTOP);
    Object.defineProperty(window, "DeviceOrientationEvent", { configurable: true, value: class {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function orientation(beta: number | null, gamma: number | null) {
    const event = new Event("deviceorientation") as Event & { beta: number | null; gamma: number | null };
    event.beta = beta;
    event.gamma = gamma;
    return event;
  }

  it("flips to true when a real sensor reading arrives inside the probe window", () => {
    const seen: boolean[] = [];
    render(<Probe onValue={(value) => seen.push(value)} />);
    expect(seen.at(-1)).toBe(false);

    act(() => {
      window.dispatchEvent(orientation(null, null));
    });
    expect(seen.at(-1)).toBe(false);

    act(() => {
      window.dispatchEvent(orientation(12, 3));
    });
    expect(seen.at(-1)).toBe(true);
  });

  it("stops listening after the probe window", () => {
    const seen: boolean[] = [];
    render(<Probe onValue={(value) => seen.push(value)} />);

    act(() => {
      vi.advanceTimersByTime(SENSOR_PROBE_MS + 1);
      window.dispatchEvent(orientation(12, 3));
    });
    expect(seen.at(-1)).toBe(false);
  });
});
