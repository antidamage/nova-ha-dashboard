import type { WashTimer, WashTimerConfig } from "./types";

/**
 * The wash's timer (specs/power-meters.md, "The wash's timer").
 *
 * A claim starts it for `firstPeriodMinutes`. When a period runs out and the
 * machine is still drawing power to do a wash, the timer is extended by
 * `extendMinutes` and waits again; it finishes once the machine has been quiet
 * for `stopSeconds` of observed sample time.
 *
 * Pure, like the cycle model beside it: the caller owns the clock and the meter
 * reading, so every boundary is testable without a timer or a disk.
 */

/** A claim starts the timer: the first period runs from here. */
export function beginWashTimer(at: string, config: WashTimerConfig): WashTimer {
  return {
    completedAt: null,
    endsAt: new Date(Date.parse(at) + config.firstPeriodMinutes * 60_000).toISOString(),
    extensions: 0,
    orbTimerId: null,
    startedAt: at,
  };
}

/**
 * One tick of the timer against a meter reading. Extends only when the period
 * has actually run out and the machine is still drawing power to do a wash.
 *
 * A period whose end is more than one extension in the past — the app was down,
 * or the meter was unreachable — is anchored to now rather than replaying every
 * period nobody was watching.
 */
export function advanceWashTimer(
  timer: WashTimer,
  options: { at: string; config: WashTimerConfig; drawing: boolean },
): { extended: boolean; timer: WashTimer } {
  if (!options.drawing || timer.completedAt !== null) return { extended: false, timer };
  const at = Date.parse(options.at);
  const endsAt = Date.parse(timer.endsAt);
  if (!Number.isFinite(at) || !Number.isFinite(endsAt) || at < endsAt) return { extended: false, timer };
  const extensionMs = options.config.extendMinutes * 60_000;
  const base = at > endsAt + extensionMs ? at : endsAt;
  return {
    extended: true,
    timer: { ...timer, endsAt: new Date(base + extensionMs).toISOString(), extensions: timer.extensions + 1 },
  };
}

/** The machine has been quiet long enough: the wash's timer is done. */
export function completeWashTimer(timer: WashTimer, at: string): WashTimer {
  return timer.completedAt === null ? { ...timer, completedAt: at } : timer;
}
