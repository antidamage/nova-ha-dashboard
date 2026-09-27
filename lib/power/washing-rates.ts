// The plan the washing machine is costed at.
//
// The wash is costed at the machine's own plan, not the household's, because the
// two are not always the same: this household's washer is costed at its
// retailer's rates for the address while the grid keeps its own tariff. With no
// plan of its own configured the wash follows the household's, so a
// single-plan install needs no extra config — and neither does a household that
// has not been told what it pays, which is a supported state (see ./tariff).
//
// The machine's own plan states its rates in cents per kWh INCLUDING GST, and
// that is what a wash's cost reads as. The household-tariff fallback makes no
// such claim — `PowerTariffSchema` says nothing about tax — so nothing here
// asserts one on its behalf; a surface that prints a rate says "including GST"
// only where the plan it resolved says so (`WashMonthRate.includingGst`).
// See specs/power-meters.md §4.1.
import type { WashRateWindow } from "../config-schema";
import { localParts } from "./calendar";
import { powerConfig } from "./store";
import { currentRate } from "./tariff";

export type WashRate = {
  /**
   * The unit rate in force at the instant asked about, cents per kWh. The
   * machine's own plan includes GST in it; the household tariff's own tax
   * treatment is not stated anywhere, so nothing here claims one.
   */
  cPerKwh: number;
  /** The plan the rate belongs to, for the surfaces that label it. */
  planName: string;
  sourceUrl: string;
  /** The window that set the rate, when a window did. */
  windowLabel: string | null;
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The window's own day key for the local day before `day`. */
function previousDay(day: string) {
  const index = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
  return WEEKDAYS[(index + 6) % WEEKDAYS.length];
}

/**
 * The window covering this instant, if any.
 *
 * A window is anchored on the day it OPENS, so `21:00`-`07:00` is the evening it
 * began: after midnight it is still that evening's window and the day list is
 * read against yesterday. A window whose end is *before* its start is the
 * crossing one; an equal pair is an empty window and matches nothing.
 */
export function washRateWindow(windows: WashRateWindow[], date: Date): WashRateWindow | undefined {
  const parts = localParts(date);
  const minute = parts.hour * 60 + parts.minute;
  const day = parts.weekday.toLowerCase().slice(0, 3);
  const yesterday = previousDay(day);
  return windows.find((window) => {
    if (window.fromMinute === window.toMinute) return false;
    return window.fromMinute < window.toMinute
      ? window.days.includes(day as (typeof WEEKDAYS)[number]) &&
        minute >= window.fromMinute &&
        minute < window.toMinute
      : (window.days.includes(day as (typeof WEEKDAYS)[number]) && minute >= window.fromMinute) ||
        (window.days.includes(yesterday) && minute < window.toMinute);
  });
}

/**
 * The wash's plan, or null when it follows the household's tariff.
 * Read from config, so a caller can label the rate without re-deriving it.
 */
export function washRates() {
  return powerConfig().washingMachine?.rates ?? null;
}

/**
 * The rate in force at `date`, in cents per kWh.
 *
 * Cost is struck at the rate in force at the time of the sample, so a wash that
 * spans a plan's free hours is costed as the bill will cost it — the free window
 * is free for the part of the wash inside it.
 */
export function washRateAt(date: Date): WashRate {
  const rates = washRates();
  if (!rates) {
    const household = currentRate(date);
    return {
      cPerKwh: household.cPerKwh,
      planName: household.displayName,
      sourceUrl: household.sourceUrl,
      windowLabel: null,
    };
  }
  const window = washRateWindow(rates.windows, date);
  return {
    cPerKwh: window?.cPerKwh ?? rates.cPerKwh,
    planName: rates.planName,
    sourceUrl: rates.sourceUrl ?? "",
    windowLabel: window?.label ?? null,
  };
}
