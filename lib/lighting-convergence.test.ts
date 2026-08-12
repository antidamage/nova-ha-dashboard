import { beforeEach, describe, expect, it } from "vitest";
import {
  brightnessPctFromAttribute,
  claimLightingBrightnessTargets,
  lightingBrightnessTargetEntityIds,
  lightingBrightnessTargetFor,
  needsBrightnessConvergence,
  releaseLightingBrightnessTarget,
  releaseLightingBrightnessTargets,
  resetLightingConvergenceForTest,
} from "./lighting-convergence";

describe("lighting convergence targets", () => {
  beforeEach(() => {
    resetLightingConvergenceForTest();
  });

  it("tracks the commanded brightness per entity", () => {
    const token = claimLightingBrightnessTargets([
      { entityId: "light.lounge", brightnessPct: 40 },
      { entityId: "light.kitchen", brightnessPct: 40 },
    ]);

    expect(lightingBrightnessTargetEntityIds(token).sort()).toEqual(["light.kitchen", "light.lounge"]);
    expect(lightingBrightnessTargetFor("light.lounge", token)).toBe(40);
  });

  it("hands an entity to the newest command so an older follow-up stands down", () => {
    const first = claimLightingBrightnessTargets([{ entityId: "light.lounge", brightnessPct: 40 }]);
    const second = claimLightingBrightnessTargets([{ entityId: "light.lounge", brightnessPct: 70 }]);

    expect(lightingBrightnessTargetFor("light.lounge", first)).toBeNull();
    expect(lightingBrightnessTargetFor("light.lounge", second)).toBe(70);
    expect(lightingBrightnessTargetEntityIds(first)).toEqual([]);
  });

  it("only releases targets the command still owns", () => {
    const first = claimLightingBrightnessTargets([{ entityId: "light.lounge", brightnessPct: 40 }]);
    const second = claimLightingBrightnessTargets([{ entityId: "light.lounge", brightnessPct: 70 }]);

    releaseLightingBrightnessTarget("light.lounge", first);
    expect(lightingBrightnessTargetFor("light.lounge", second)).toBe(70);

    releaseLightingBrightnessTargets(second);
    expect(lightingBrightnessTargetFor("light.lounge", second)).toBeNull();
  });

  it("converts Home Assistant's 0..255 brightness to percent", () => {
    expect(brightnessPctFromAttribute(255)).toBe(100);
    expect(brightnessPctFromAttribute(102)).toBe(40);
    expect(brightnessPctFromAttribute(null)).toBeNull();
    expect(brightnessPctFromAttribute(Number.NaN)).toBeNull();
  });

  it("treats device rounding as arrived and a stalled fade as not", () => {
    expect(needsBrightnessConvergence(40, 40)).toBe(false);
    expect(needsBrightnessConvergence(42, 40)).toBe(false);
    expect(needsBrightnessConvergence(38, 40)).toBe(false);
    expect(needsBrightnessConvergence(70, 40)).toBe(true);
    // A light that is on but reporting no usable brightness is worth re-sending.
    expect(needsBrightnessConvergence(null, 40)).toBe(true);
  });
});
