import { describe, expect, it } from "vitest";
import { handoffFragment, smoothRateFor, smoothStreamTime } from "./smooth-position-model";

const fragments = Array.from({ length: 10 }, (_, index) => ({ start: index * 2 }));

describe("smoothRateFor", () => {
  it("is only the rates the pipeline makes 60 fps from", () => {
    expect(smoothRateFor(0.5)).toBe(0.5);
    expect(smoothRateFor(1)).toBe(1);
    for (const rate of [-1, -0.5, 1.5, 2, 10]) expect(smoothRateFor(rate)).toBeNull();
  });
});

describe("handoffFragment", () => {
  it("leaves the pipeline ten seconds of real time to start", () => {
    expect(handoffFragment(fragments, 0, 1)?.start).toBe(10);
    expect(handoffFragment(fragments, 1, 1)?.start).toBe(12);
  });

  it("needs less footage ahead at half speed, as it plays through it more slowly", () => {
    expect(handoffFragment(fragments, 0, 0.5)?.start).toBe(6);
  });

  it("finds nothing when the footage ends too soon", () => {
    expect(handoffFragment(fragments, 9, 1)).toBeNull();
  });
});

describe("smoothStreamTime", () => {
  it("is the stream's start at the handoff", () => {
    expect(smoothStreamTime(8, 8, 1, 0, 0)).toBe(0);
  });

  it("runs twice as far through the stream at half speed", () => {
    expect(smoothStreamTime(10, 8, 0.5, 0, 0)).toBe(4);
  });

  it("follows the playlist's window as old segments leave it", () => {
    expect(smoothStreamTime(30, 8, 1, 5, 100)).toBe(117);
  });
});
