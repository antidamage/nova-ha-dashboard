import { describe, expect, it } from "vitest";
import { normalizePhonoscopeParameterSource } from "./phonoscope-store";

describe("normalizePhonoscopeParameterSource", () => {
  it("migrates a legacy envelope without a hold phase", () => {
    expect(normalizePhonoscopeParameterSource({
      type: "bass",
      min: 1,
      max: 1.5,
      attackSeconds: 0.05,
      releaseSeconds: 0.5,
    })).toEqual({
      type: "bass",
      min: 1,
      max: 1.5,
      attackSeconds: 0.05,
      holdSeconds: 0,
      releaseSeconds: 0.5,
    });
  });

  it("replaces malformed envelope timings and keeps the total within the timeline", () => {
    expect(normalizePhonoscopeParameterSource({
      type: "energy",
      min: 0,
      max: 1,
      attackSeconds: Number.NaN,
      holdSeconds: 20,
      releaseSeconds: -4,
    })).toEqual({
      type: "energy",
      min: 0,
      max: 1,
      attackSeconds: 0.05,
      holdSeconds: 11.95,
      releaseSeconds: 0,
    });
  });

  it("rejects unknown source kinds instead of leaking partial data", () => {
    expect(normalizePhonoscopeParameterSource({ type: "future-driver" })).toBeNull();
    expect(normalizePhonoscopeParameterSource(null)).toBeNull();
  });
});
