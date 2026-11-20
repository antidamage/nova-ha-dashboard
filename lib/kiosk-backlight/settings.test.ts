import { describe, expect, it } from "vitest";
import type { SunStatus } from "../types/status";
import {
  DEFAULT_KIOSK_BACKLIGHT,
  kioskBacklightMessage,
  kioskBacklightPeriodFor,
  normalizeKioskBacklightSettings,
} from "./settings";

const night = { state: "below_horizon" } as SunStatus;
const day = { state: "above_horizon" } as SunStatus;

describe("kiosk backlight settings", () => {
  it("defaults to 100/30 by day without blanking, 60/0 at night with blanking", () => {
    expect(normalizeKioskBacklightSettings(undefined)).toEqual(DEFAULT_KIOSK_BACKLIGHT);
    expect(DEFAULT_KIOSK_BACKLIGHT.day).toEqual({ brightnessPct: 100, dimPct: 30, offWhenDim: false });
    expect(DEFAULT_KIOSK_BACKLIGHT.night).toEqual({ brightnessPct: 60, dimPct: 0, offWhenDim: true });
  });

  it("clamps ranges, and never lets the dim level exceed the brightness", () => {
    const settings = normalizeKioskBacklightSettings({
      day: { brightnessPct: 140, dimPct: -5, offWhenDim: "yes" },
      night: { brightnessPct: 40, dimPct: 70, offWhenDim: false },
    });
    expect(settings.day).toEqual({ brightnessPct: 100, dimPct: 0, offWhenDim: false });
    expect(settings.night).toEqual({ brightnessPct: 40, dimPct: 40, offWhenDim: false });
    expect(normalizeKioskBacklightSettings({ day: { brightnessPct: 0 } }).day.brightnessPct).toBe(1);
  });

  it("fills a partial period from the defaults", () => {
    const settings = normalizeKioskBacklightSettings({ night: { dimPct: 10 } });
    expect(settings.night).toEqual({ brightnessPct: 60, dimPct: 10, offWhenDim: true });
    expect(settings.day).toEqual(DEFAULT_KIOSK_BACKLIGHT.day);
  });

  it("picks the period from the sun, as the lights do", () => {
    expect(kioskBacklightPeriodFor(night)).toBe("night");
    expect(kioskBacklightPeriodFor(day)).toBe("day");
    expect(kioskBacklightMessage(undefined, night)).toEqual({ target: 60, dim: 0, off: true });
    expect(kioskBacklightMessage({ day: { brightnessPct: 80, dimPct: 20, offWhenDim: true } }, day)).toEqual({
      target: 80,
      dim: 20,
      off: true,
    });
  });
});
