import { describe, expect, it } from "vitest";
import { decimalStepGranularity } from "./slider-step";

describe("decimalStepGranularity", () => {
  it("uses every place expressed by a decimal step", () => {
    expect(decimalStepGranularity(1)).toBe(1);
    expect(decimalStepGranularity(0.5)).toBe(0.1);
    expect(decimalStepGranularity(0.25)).toBe(0.01);
    expect(decimalStepGranularity(0.05)).toBe(0.01);
    expect(decimalStepGranularity(0.005)).toBe(0.001);
    expect(decimalStepGranularity(1e-7)).toBe(1e-7);
  });
});
