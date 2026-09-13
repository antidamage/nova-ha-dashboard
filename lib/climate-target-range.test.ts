import { describe, expect, it } from "vitest";
import { normalizeClimateTargetRange } from "./climate-preferences";

describe("normalizeClimateTargetRange", () => {
  it("snaps to 0.5 inside 5-30", () => {
    expect(normalizeClimateTargetRange({ min: 17.3, max: 40 })).toEqual({ min: 17.5, max: 30 });
  });
  it("orders swapped thumbs", () => {
    expect(normalizeClimateTargetRange({ min: 25, max: 18 })).toEqual({ min: 18, max: 25 });
  });
  it("keeps the thumbs 1 degree apart", () => {
    expect(normalizeClimateTargetRange({ min: 30, max: 30 })).toEqual({ min: 29, max: 30 });
    expect(normalizeClimateTargetRange({ min: 20, max: 20.5 })).toEqual({ min: 20, max: 21 });
  });
  it("rejects non-numbers", () => {
    expect(() => normalizeClimateTargetRange({ min: "a" })).toThrow();
  });
});
