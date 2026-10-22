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
  endFadeAngle,
  fanStepText,
  hexToRgb,
  temperatureColour,
  temperatureGlowPaint,
  temperatureRingMark,
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
  const rgba = (hex: string, alpha: number) => `rgba(${hexToRgb(hex).join(", ")}, ${alpha})`;

  it("puts the room left of the mark and the target right of it, from 7:30", () => {
    const paint = temperatureRingPaint(26, 18, 200);
    const half = (blendAngle(200) / 2).toFixed(2);
    expect(paint.startsWith("conic-gradient(from 225deg")).toBe(true);
    expect(paint).toContain(`${rgba(TEMPERATURE_COLD, 1)} calc(var(--re-mark) - ${half}deg)`);
    expect(paint).toContain(`${rgba(TEMPERATURE_HOT, 1)} calc(var(--re-mark) + ${half}deg)`);
  });

  it("fades both colours out at their outer ends, so they never meet across the bottom", () => {
    const paint = temperatureRingPaint(26, 18, 200);
    expect(paint).toContain(`${rgba(TEMPERATURE_COLD, 0)} 0deg`);
    expect(paint).toContain(`${rgba(TEMPERATURE_COLD, 1)} min(${endFadeAngle(200).toFixed(2)}deg, var(--re-mark) * 0.5)`);
    expect(paint).toContain(`${rgba(TEMPERATURE_HOT, 0)} max(270deg, calc(var(--re-mark) + ${blendAngle(200).toFixed(2)}deg))`);
    expect(paint).toContain(`${rgba(TEMPERATURE_HOT, 0)} 360deg)`);
    expect(paint.endsWith(", var(--re-ring-empty)")).toBe(true);
  });

  it("blends over about 30px of arc, so a small knob blends over more degrees", () => {
    // 30px at the ring's mid radius: 15.6° on a 200px knob.
    expect(blendAngle(200)).toBeCloseTo((30 / 110) * (180 / Math.PI), 4);
    expect(blendAngle(100)).toBeGreaterThan(blendAngle(200));
    expect(endFadeAngle(200)).toBeCloseTo(blendAngle(200) * (40 / 30), 4);
  });

  it("shows a dark room side when the room has no reading", () => {
    expect(temperatureRingPaint(22, null, 200)).toContain(rgba(TEMPERATURE_UNKNOWN, 1));
  });

  it("puts the mark where the index is: 0 at the floor, 270 at the ceiling", () => {
    expect(temperatureRingMark(16, 16, 30)).toBe(0);
    expect(temperatureRingMark(23, 16, 30)).toBe(135);
    expect(temperatureRingMark(30, 16, 30)).toBe(270);
    expect(temperatureRingMark(40, 16, 30)).toBe(270);
  });
});

describe("the glow", () => {
  it("only glows while the unit is running, along the target's arc", () => {
    expect(temperatureGlowPaint(24, 200, false)).toBe("none");
    const glow = temperatureGlowPaint(24, 200, true);
    expect(glow.startsWith("conic-gradient(from 225deg")).toBe(true);
    expect(glow).toMatch(/, 0\.62\) calc\(var\(--re-mark\) \+/);
    expect(glow).toMatch(/, 0\) max\(270deg, calc\(var\(--re-mark\) \+/);
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
    expect(fanStepText("aggressive")).toBe("AGGRESSIVE");
    expect(FAN_VALUE_WIDEST).toBe("AGGRESSIVE");
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
