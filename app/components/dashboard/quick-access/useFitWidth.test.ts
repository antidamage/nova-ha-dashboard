import { describe, expect, it } from "vitest";
import { FIT_WIDTH_MIN, fitWidthFactor } from "./useFitWidth";

describe("fitWidthFactor", () => {
  it("leaves a row that fits at full size", () => {
    expect(fitWidthFactor(300, 240)).toBe(1);
    expect(fitWidthFactor(300, 300)).toBe(1);
  });

  it("scales a row that is too wide down to the available width", () => {
    expect(fitWidthFactor(150, 300)).toBe(0.5);
    expect(fitWidthFactor(200, 300)).toBe(0.667);
  });

  it("does nothing before anything is measured", () => {
    expect(fitWidthFactor(0, 300)).toBe(1);
    expect(fitWidthFactor(300, 0)).toBe(1);
  });

  it("never scales below the sanity clamp", () => {
    expect(fitWidthFactor(1, 10000)).toBe(FIT_WIDTH_MIN);
  });
});
