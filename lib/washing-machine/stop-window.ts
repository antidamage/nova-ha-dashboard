import type { WashTimerConfig } from "./types";

/** Whole seconds between two instants, or a non-finite number for a bad one. */
export function seconds(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

/**
 * The window that says the machine has stopped (specs/power-meters.md §4.1, and
 * "The wash's timer" for what it finishes).
 *
 * The wash's timer and the completion record settle on this **one** edge, so the
 * timer's chime and the wash's notification describe the same moment.
 *
 * The metering plugs report on change: once the machine settles at its quiet draw
 * the integration stops writing that entity, so `last_reported` freezes at the
 * instant of the drop and never moves again (measured on the live Tuya cloud
 * bridge 2026-09-22 — frozen at the drop for 26 minutes at 0 W, with
 * `homeassistant.update_entity` every 30 s not moving it either). A report old
 * enough to be stale therefore cannot anchor the window — that would backdate it
 * to a moment nobody was watching — but it is not grounds for discarding the
 * window either: the value it carries is still the meter's last word. The window
 * is measured in observed sample time, the same clock the close timer uses, and
 * each tick that observes the quiet draw extends it.
 *
 * Pure: the caller owns the clock, the meter reading and the config.
 */
export function observeQuiet(
  zeroSince: string | null,
  options: {
    at: string;
    /** How long the previous reading stood for; 0 when the gap was not trusted. */
    elapsedHours: number;
    /** Observed seconds since the previous sample. */
    gap: number;
    kwh: number;
    minCycleKwh: number;
    /** The meter's own report time for this reading. */
    reportedAt: string;
    stop: WashTimerConfig;
    watts: number;
  },
): { finished: boolean; zeroSince: string | null } {
  const { at, elapsedHours, gap, stop, watts } = options;
  const quiet = watts <= stop.stopWatts;
  // A sample gap, an untrusted interval, or a machine still drawing more than the
  // quiet draw: none of them say anything about the machine having stopped.
  const restarts = gap < 0 || gap > stop.maxSampleGapSeconds || elapsedHours <= 0 || !quiet;
  // A fresh report says when the drop actually happened; a stale one only says
  // the quiet draw is standing now, so the window starts at this sample.
  const age = seconds(options.reportedAt, at);
  const fresh = Number.isFinite(age) && age >= -5 && age <= stop.maxSampleGapSeconds;
  // A quiet reading anchors the window even on the tick that restarts it: a
  // sample gap is not evidence either way, and this sample is one someone took.
  const since = quiet ? (restarts ? null : zeroSince) ?? (fresh ? options.reportedAt : at) : null;
  return {
    finished: since !== null && options.kwh >= options.minCycleKwh && seconds(since, at) > stop.stopSeconds,
    zeroSince: since,
  };
}
