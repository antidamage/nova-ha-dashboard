import { describe, expect, it } from "vitest";
import {
  FAN_VALUE_WIDEST,
  TEMPERATURE_COLD,
  TEMPERATURE_HOT,
  TEMPERATURE_MID,
  TEMPERATURE_UNKNOWN,
  TIMER_VALUE_WIDEST,
  blendAngle,
  effectiveTargetRange,
  fanStepText,
  hexToRgb,
  temperatureColour,
  temperatureGlow,
  temperatureRingPaint,
  timerMinutesRemaining,
  timerValueText,
} from "./temperatureEncoderModel";

const rgb = (hex: string) => `rgb(${hexToRgb(hex).join(", ")})`;

describe("the temperature colour scale", () => {
  it("runs ice blue at 18, pale warm white at 22, orange-red at 26", () => {
    expect(temperatureColour(18)).toBe(rgb(TEMPERATURE_COLD));
    expect(temperatureColour(22)).toBe(rgb(TEMPERATURE_MID));
    expect(temperatureColour(26)).toBe(rgb(TEMPERATURE_HOT));
  });

  it("clamps outside the scale rather than running on", () => {
    expect(temperatureColour(2)).toBe(temperatureColour(18));
    expect(temperatureColour(40)).toBe(temperatureColour(26));
  });

  it("reads a missing temperature as dark charcoal, never as a guess", () => {
    expect(temperatureColour(null)).toBe(TEMPERATURE_UNKNOWN);
    expect(temperatureColour(undefined)).toBe(TEMPERATURE_UNKNOWN);
    expect(temperatureColour(Number.NaN)).toBe(TEMPERATURE_UNKNOWN);
  });

  it("moves through the middle rather than jumping at it", () => {
    const warm = temperatureColour(24);
    expect(warm).not.toBe(temperatureColour(22));
    expect(warm).not.toBe(temperatureColour(26));
  });
});

describe("the ring's paint", () => {
  it("puts the target across the top and the room across the bottom", () => {
    const paint = temperatureRingPaint(26, 18, 200);
    const hot = rgb(TEMPERATURE_HOT);
    const cold = rgb(TEMPERATURE_COLD);
    expect(paint.startsWith("conic-gradient(from 0deg")).toBe(true);
    // Top half at 0°, bottom half at 180°.
    expect(paint).toContain(`${hot} 0deg`);
    expect(paint).toContain(`${cold} ${(90 + blendAngle(200) / 2).toFixed(2)}deg`);
    expect(paint).toContain(`${hot} 360deg`);
  });

  it("blends over about 30px of arc, so a small knob blends over more degrees", () => {
    // 30px at the ring's mid radius: 15.6° on a 200px knob.
    expect(blendAngle(200)).toBeCloseTo((30 / 110) * (180 / Math.PI), 4);
    expect(blendAngle(100)).toBeGreaterThan(blendAngle(200));
  });

  it("shows a dark bottom half when the room has no reading", () => {
    expect(temperatureRingPaint(22, null, 200)).toContain(TEMPERATURE_UNKNOWN);
  });
});

describe("the glow", () => {
  it("only glows while the unit is running", () => {
    expect(temperatureGlow(24, 200, false)).toBe("0 0 0 rgba(0, 0, 0, 0)");
    expect(temperatureGlow(24, 200, true)).toMatch(/^0 0 28\.0px 2\.4px rgba\(/);
  });
});

describe("the timer ring", () => {
  it("counts whole minutes left, rounded up", () => {
    const now = Date.parse("2026-09-12T10:00:00Z");
    expect(timerMinutesRemaining("2026-09-12T10:38:00Z", now)).toBe(38);
    // Thirty seconds left is still a minute on the ring, not nothing.
    expect(timerMinutesRemaining("2026-09-12T10:00:30Z", now)).toBe(1);
    expect(timerMinutesRemaining("2026-09-12T09:59:00Z", now)).toBe(0);
    expect(timerMinutesRemaining(null, now)).toBe(0);
    expect(timerMinutesRemaining("not a date", now)).toBe(0);
  });

  it("says OFF at the bottom and minutes above it", () => {
    expect(timerValueText(0)).toBe("OFF");
    expect(timerValueText(2)).toBe("2 MIN");
    expect(timerValueText(240)).toBe("240 MIN");
    expect(TIMER_VALUE_WIDEST).toBe("240 MIN");
  });
});

describe("the fan ring", () => {
  it("names every step, and knows its widest", () => {
    expect(fanStepText("quiet")).toBe("QUIET");
    expect(fanStepText("medium low")).toBe("MED LOW");
    expect(fanStepText("medium high")).toBe("MED HIGH");
    expect(fanStepText("turbo")).toBe("TURBO");
    expect(FAN_VALUE_WIDEST).toBe("MED HIGH");
  });
});

describe("effectiveTargetRange", () => {
  const hard = { min: 16, max: 30 };
  it("uses the hard limits with no preference", () => {
    expect(effectiveTargetRange(hard)).toEqual(hard);
  });
  it("narrows to the preferred range", () => {
    expect(effectiveTargetRange(hard, { min: 18, max: 25 })).toEqual({ min: 18, max: 25 });
  });
  it("keeps inside the hard limits", () => {
    expect(effectiveTargetRange(hard, { min: 5, max: 24 })).toEqual({ min: 16, max: 24 });
  });
  it("falls back when the ranges do not overlap", () => {
    expect(effectiveTargetRange(hard, { min: 5, max: 12 })).toEqual(hard);
  });
});
