import { describe, expect, it } from "vitest";
import {
  complementRgb,
  housePartyNativeTransitionSeconds,
  randomHueOffsetRgb,
  resolveHousePartyFrame,
} from "./house-party";

describe("House Party lighting transforms", () => {
  it("rotates hue by 180 degrees", () => {
    expect(complementRgb([255, 0, 0])).toEqual([0, 255, 255]);
    expect(complementRgb([0, 255, 0])).toEqual([255, 0, 255]);
  });

  it("follows, opposes, or ignores peak brightness", () => {
    const base = { peakRgb: [12, 34, 56] as [number, number, number], peakBrightnessPct: 20, hueMode: "follow" as const };
    expect(resolveHousePartyFrame({ ...base, brightnessMode: "follow" })).toEqual({
      rgb: [12, 34, 56],
      brightnessPct: 20,
    });
    expect(resolveHousePartyFrame({ ...base, brightnessMode: "oppose" }).brightnessPct).toBe(85);
    expect(resolveHousePartyFrame({ ...base, brightnessMode: "ignore" }).brightnessPct).toBeUndefined();
  });

  it("resolves an independently predicted cloud brightness", () => {
    expect(resolveHousePartyFrame({
      peakRgb: [12, 34, 56],
      peakBrightnessPct: 20,
      cloudPeakBrightnessPct: 80,
      hueMode: "follow",
      brightnessMode: "oppose",
    })).toMatchObject({
      brightnessPct: 85,
      cloudBrightnessPct: 25,
    });
  });

  it("uses native interpolation only for lights that advertise transition support", () => {
    expect(housePartyNativeTransitionSeconds(36)).toBe(0.4);
    expect(housePartyNativeTransitionSeconds(32)).toBe(0.4);
    expect(housePartyNativeTransitionSeconds(36, 0.25)).toBe(0.25);
    expect(housePartyNativeTransitionSeconds(36, 8)).toBe(2);
    expect(housePartyNativeTransitionSeconds(4)).toBeUndefined();
    expect(housePartyNativeTransitionSeconds(0)).toBeUndefined();
  });

  it("samples continuously across the configured symmetric hue range", () => {
    expect(randomHueOffsetRgb([255, 0, 0], 60, () => 0)).toEqual([255, 0, 255]);
    expect(randomHueOffsetRgb([255, 0, 0], 60, () => 0.25)).toEqual([255, 0, 128]);
    expect(randomHueOffsetRgb([255, 0, 0], 60, () => 0.5)).toEqual([255, 0, 0]);
    expect(randomHueOffsetRgb([255, 0, 0], 60, () => 0.75)).toEqual([255, 128, 0]);
    expect(randomHueOffsetRgb([255, 0, 0], 60, () => 1)).toEqual([255, 255, 0]);
  });

  it("leaves colours unchanged when the random hue range is zero", () => {
    expect(randomHueOffsetRgb([12, 34, 56], 0, () => 1)).toEqual([12, 34, 56]);
  });
});
