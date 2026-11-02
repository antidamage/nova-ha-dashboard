import { describe, expect, it } from "vitest";
import { FAST_PLAYBACK_RATE, FAST_PLAYBACK_THRESHOLD_SECONDS, LIVE_TARGET_LATENCY_SECONDS } from "./constants";
import {
  JOG_DEFAULT_RATE,
  JOG_STOPS,
  formatJogRate,
  forwardPlaybackRate,
  jogRateAt,
  jogReachedLiveEdge,
  jogStopIndex,
  oldestSafePosition,
  overtakenByWindow,
  reverseStep,
} from "./jog-model";

describe("jog stops", () => {
  it("runs -10 to +10 in whole steps, with 0.5x either side of a standstill and no 0", () => {
    expect(JOG_STOPS[0]).toBe(-10);
    expect(JOG_STOPS[JOG_STOPS.length - 1]).toBe(10);
    expect(JOG_STOPS).toContain(-0.5);
    expect(JOG_STOPS).toContain(0.5);
    expect(JOG_STOPS).not.toContain(0);
    const wholes = JOG_STOPS.filter((stop) => Math.abs(stop) >= 1);
    expect(wholes).toEqual([...wholes].sort((a, b) => a - b));
    expect(wholes).toHaveLength(20);
  });

  it("maps every stop to its index and back", () => {
    JOG_STOPS.forEach((stop, index) => {
      expect(jogStopIndex(stop)).toBe(index);
      expect(jogRateAt(index)).toBe(stop);
    });
  });

  it("clamps an index outside the dial", () => {
    expect(jogRateAt(-3)).toBe(-10);
    expect(jogRateAt(99)).toBe(10);
  });

  it("rests on 1x", () => {
    expect(jogRateAt(jogStopIndex(JOG_DEFAULT_RATE))).toBe(1);
  });

  it("formats rates with a real minus sign", () => {
    expect(formatJogRate(1)).toBe("1x");
    expect(formatJogRate(0.5)).toBe("0.5x");
    expect(formatJogRate(1.5)).toBe("1.5x");
    expect(formatJogRate(-10)).toBe("−10x");
  });
});

describe("forward rate", () => {
  const farBehind = FAST_PLAYBACK_THRESHOLD_SECONDS + 1;

  it("keeps the catch-up rule while no jog is set", () => {
    expect(forwardPlaybackRate(null, farBehind)).toBe(FAST_PLAYBACK_RATE);
    expect(forwardPlaybackRate(null, 5)).toBe(1);
  });

  it("obeys a set jog over the catch-up rule, including 1x", () => {
    expect(forwardPlaybackRate(1, farBehind)).toBe(1);
    expect(forwardPlaybackRate(0.5, farBehind)).toBe(0.5);
    expect(forwardPlaybackRate(10, 5)).toBe(10);
  });
});

describe("reaching the live edge", () => {
  it("ends a faster-than-real-time jog at the place Live sits", () => {
    expect(jogReachedLiveEdge(2, LIVE_TARGET_LATENCY_SECONDS)).toBe(true);
    expect(jogReachedLiveEdge(2, LIVE_TARGET_LATENCY_SECONDS + 1)).toBe(false);
  });

  it("leaves real-time, slower and unset playback where it is", () => {
    expect(jogReachedLiveEdge(1, 0)).toBe(false);
    expect(jogReachedLiveEdge(0.5, 0)).toBe(false);
    expect(jogReachedLiveEdge(-5, 0)).toBe(false);
    expect(jogReachedLiveEdge(null, 0)).toBe(false);
  });
});

describe("reverse step", () => {
  it("covers the elapsed time at the jog rate", () => {
    expect(reverseStep(100, -5, 0.2, 0)).toEqual({ time: 99, atStart: false });
    expect(reverseStep(100, -0.5, 2, 0)).toEqual({ time: 99, atStart: false });
  });

  it("stops at the start of the recording", () => {
    expect(reverseStep(10, -10, 2, 5)).toEqual({ time: 5, atStart: true });
  });
});

describe("oldest position", () => {
  it("sits inside the live playlist, not at hls.js's seekable start of 0", () => {
    expect(oldestSafePosition(0, 7300, 100)).toBe(106);
  });

  it("uses the seekable start where the player reports a real one", () => {
    expect(oldestSafePosition(50, 7300)).toBe(56);
    expect(oldestSafePosition(50, 7300, null)).toBe(56);
  });

  it("never passes the end of a short window", () => {
    expect(oldestSafePosition(0, 3, 0)).toBe(3);
  });

  it("is overtaken only once the window has nearly reached the position", () => {
    expect(overtakenByWindow(106, 106)).toBe(false);
    expect(overtakenByWindow(102.5, 106)).toBe(false);
    expect(overtakenByWindow(101.5, 106)).toBe(true);
  });
});
