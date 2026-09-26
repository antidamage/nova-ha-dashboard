"use client";

// The stall-reload watchdog's decision, separated from React so it can be
// pinned by a test. The page has ONE last-resort reload: if it has been visible
// for five minutes and no server snapshot has arrived by any path, it is wedged
// and reloading is the only way out (2026-07-11: hung connection pool plus a
// silently dead EventSource left the screen on "Loading zone controls" for 70+
// minutes against a healthy server).
//
// The distinction this exists for: a page that has been in the BACKGROUND is
// not a wedged page, and the time it spent hidden must not count towards the
// five minutes. Counting it is what made a suspended page — iOS/Android
// backgrounding, a frozen Chrome tab, a bfcache restore — reload itself the
// moment it came back, which is the behaviour this fixes.

export const STALL_TICK_MS = 30_000;
export const STALL_RELOAD_AFTER_MS = 5 * 60_000;
export const STALL_RELOAD_MIN_GAP_MS = 15 * 60_000;
export const STALL_RELOAD_STAMP_KEY = "nova.dashboard.stallReloadAt.v1";
/**
 * A gap between ticks longer than this means no tick ran — the page was
 * suspended, or its timer was throttled to a standstill. Whatever the counter had
 * accumulated belongs to the page's previous life, and the snapshot clock says
 * nothing about this one, so the stall starts over.
 *
 * Three intervals, deliberately not two: Chrome throttles a hidden page's timers
 * to one a minute, so a page that is merely in the background must still be able
 * to carry its counter rather than being reset on every throttled tick.
 */
export const STALL_GAP_RESET_MS = 3 * STALL_TICK_MS;
/**
 * How many consecutive ticks the page may be hidden for before a stall it had
 * accumulated is dropped. A display that blanks for a tick keeps its stall; a
 * page that was hidden for longer than that was AWAY, and the time it spent
 * hidden must never become visible stall on the way back — which is the rule this
 * whole watchdog is here to obey.
 */
export const STALL_HIDDEN_CARRY_TICKS = 2;

export type StallTickInput = {
  /** The page is backgrounded: nothing it fails to receive is a fault. */
  hidden: boolean;
  /** A server snapshot arrived since the previous tick. */
  snapshotArrived: boolean;
  /** Visible, unproductive time accumulated before this tick. */
  stalledVisibleMs: number;
  /** Time since the previous tick — how long this page was not running tick(s). */
  msSinceLastTick: number;
  /** How many ticks in a row before this one found the page hidden. */
  hiddenTicksBefore: number;
  /** How long ago this code last reloaded for a stall. */
  msSinceStallReload: number;
};

export type StallTickResult = {
  /** Visible stall time to carry into the next tick. */
  stalledVisibleMs: number;
  reload: boolean;
  /** Present only when `reload` — how long the page was visibly wedged. */
  reloadAfterVisibleMs?: number;
};

export function advanceStallWatchdog(input: StallTickInput): StallTickResult {
  // No tick ran for longer than a couple of intervals: the page was away (frozen,
  // suspended, or throttled to a standstill). Start over — the page that came
  // back is not the page that had nearly wedged, and the alternative is a reload
  // a moment after somebody brings it to the foreground, which is the report this
  // whole rule exists to answer.
  if (input.msSinceLastTick > STALL_GAP_RESET_MS) {
    return { stalledVisibleMs: 0, reload: false };
  }

  // A snapshot landed: whatever the page was doing, it is not wedged.
  if (input.snapshotArrived) {
    return { stalledVisibleMs: 0, reload: false };
  }

  // Hidden ticks neither advance the counter nor wipe it. Advancing is the bug
  // this rule exists to fix (the time a page spent in the background is not
  // stall time); wiping is the opposite failure — a screen whose display blanks
  // for a second mid-stall would never accumulate the five minutes and would
  // never reload at all, which is the wedge the watchdog is here for.
  if (input.hidden) {
    return { stalledVisibleMs: input.stalledVisibleMs, reload: false };
  }

  // Back on screen after a stretch of hidden ticks. A blank of a tick or two
  // keeps the stall it had nearly accumulated; anything longer means the page was
  // away, so its stall ended with it and the count starts here.
  if (input.hiddenTicksBefore > STALL_HIDDEN_CARRY_TICKS) {
    return { stalledVisibleMs: STALL_TICK_MS, reload: false };
  }

  const stalledVisibleMs = input.stalledVisibleMs + STALL_TICK_MS;
  if (stalledVisibleMs < STALL_RELOAD_AFTER_MS) {
    return { stalledVisibleMs, reload: false };
  }
  if (input.msSinceStallReload < STALL_RELOAD_MIN_GAP_MS) {
    // Loop protection: a genuinely dead server still gets one reload per
    // fifteen minutes, not one per five. The counter STAYS at the threshold, so
    // the pending stall is applied on the first tick after the gap expires —
    // the old cadence — rather than waiting another five visible minutes.
    return { stalledVisibleMs: STALL_RELOAD_AFTER_MS, reload: false };
  }
  return { stalledVisibleMs: 0, reload: true, reloadAfterVisibleMs: stalledVisibleMs };
}
