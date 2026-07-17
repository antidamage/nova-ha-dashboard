import { describe, expect, it } from "vitest";
import { normalizedWatchfacePreferences } from "./watchface-preferences";

describe("watchface preferences", () => {
  it("normalizes the global gym alert threshold", () => {
    expect(normalizedWatchfacePreferences({}).gymAlertThresholdHours).toBe(46);
    expect(normalizedWatchfacePreferences({ watchface: { gymAlertThresholdHours: 999 } }).gymAlertThresholdHours).toBe(168);
  });
});
