import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readPhonoscopeNowPlaying,
  resetPhonoscopeNowPlayingForTest,
  writePhonoscopeNowPlaying,
} from "./phonoscope-now-playing";

describe("phonoscope master clock", () => {
  afterEach(() => {
    resetPhonoscopeNowPlayingForTest();
    vi.useRealTimers();
  });

  it("accounts for Apple TV uplink age and subsequent server time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_250);
    writePhonoscopeNowPlaying({
      position: 5,
      duration: 100,
      playing: true,
      sampledAtMs: 10_000,
      source: "appletv",
    });

    expect(readPhonoscopeNowPlaying(10_750).position).toBeCloseTo(5.75, 6);
  });

  it("ignores implausible wall-clock skew", () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    const stored = writePhonoscopeNowPlaying({
      position: 8,
      playing: true,
      sampledAtMs: 1_000,
      source: "appletv",
    });

    expect(stored.position).toBe(8);
  });
});
