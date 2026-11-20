// The kiosk backlight's day and night settings (specs/kiosk-backlight.md):
// what a tap brightens the panel to, where the fade ends, and whether it then
// blanks. Day and night follow the lighting's adaptive rule (the sun).

import { adaptiveLightMode } from "../lighting-presets";
import type { SunStatus } from "../types/status";

export type KioskBacklightPeriod = {
  /** The lit target, 1-100%. */
  brightnessPct: number;
  /** Where the 30 s fade ends, 0% to brightnessPct. */
  dimPct: number;
  /** Blank the screen 2 minutes after it has dimmed. */
  offWhenDim: boolean;
};

export type KioskBacklightSettings = {
  day: KioskBacklightPeriod;
  night: KioskBacklightPeriod;
};

export type KioskBacklightPeriodName = keyof KioskBacklightSettings;

export const KIOSK_BRIGHTNESS_MIN = 1;
export const KIOSK_DIM_MIN = 0;
export const KIOSK_LEVEL_MAX = 100;
/** Below this a tap only wakes the screen (BACKLIGHT_SWALLOW_BELOW_PCT on the service). */
export const KIOSK_SWALLOW_BELOW_PCT = 25;

export const DEFAULT_KIOSK_BACKLIGHT: KioskBacklightSettings = {
  day: { brightnessPct: 100, dimPct: 30, offWhenDim: false },
  night: { brightnessPct: 60, dimPct: 0, offWhenDim: true },
};

function pct(value: unknown, fallback: number, min: number, max: number) {
  const number = value === null || value === undefined || value === "" ? Number.NaN : Number(value);
  if (!Number.isFinite(number)) return Math.max(min, Math.min(max, fallback));
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizePeriod(value: unknown, fallback: KioskBacklightPeriod): KioskBacklightPeriod {
  const source = value && typeof value === "object" ? (value as Partial<KioskBacklightPeriod>) : {};
  const brightnessPct = pct(source.brightnessPct, fallback.brightnessPct, KIOSK_BRIGHTNESS_MIN, KIOSK_LEVEL_MAX);
  // A dim level above the lit target would make the "dim" brighten.
  const dimPct = pct(source.dimPct, Math.min(fallback.dimPct, brightnessPct), KIOSK_DIM_MIN, brightnessPct);
  const offWhenDim = typeof source.offWhenDim === "boolean" ? source.offWhenDim : fallback.offWhenDim;
  return { brightnessPct, dimPct, offWhenDim };
}

/** Any stored or posted value to complete, in-range settings. */
export function normalizeKioskBacklightSettings(value: unknown): KioskBacklightSettings {
  const source = value && typeof value === "object" ? (value as Partial<KioskBacklightSettings>) : {};
  return {
    day: normalizePeriod(source.day, DEFAULT_KIOSK_BACKLIGHT.day),
    night: normalizePeriod(source.night, DEFAULT_KIOSK_BACKLIGHT.night),
  };
}

export function kioskBacklightPeriodFor(sun: SunStatus | null | undefined): KioskBacklightPeriodName {
  return adaptiveLightMode(sun) === "candlelight" ? "night" : "day";
}

/** What the page sends the kiosk service for the current period. */
export function kioskBacklightMessage(settings: unknown, sun: SunStatus | null | undefined) {
  const period = normalizeKioskBacklightSettings(settings)[kioskBacklightPeriodFor(sun)];
  return { target: period.brightnessPct, dim: period.dimPct, off: period.offWhenDim };
}
