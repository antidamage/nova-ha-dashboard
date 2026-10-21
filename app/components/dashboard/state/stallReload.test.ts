import { describe, expect, it } from "vitest";
import {
  STALL_GAP_RESET_MS,
  STALL_HIDDEN_CARRY_TICKS,
  STALL_RELOAD_AFTER_MS,
  STALL_RELOAD_MIN_GAP_MS,
  STALL_TICK_MS,
  advanceStallWatchdog,
} from "./stallReload";

/** Ticks that all found the page visible and receiving nothing. */
function stallFor(ms: number, start = 0) {
  let stalledVisibleMs = start;
  let reload = false;
  for (let elapsed = 0; elapsed < ms; elapsed += STALL_TICK_MS) {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    stalledVisibleMs = next.stalledVisibleMs;
    reload = reload || next.reload;
  }
  return { stalledVisibleMs, reload };
}

describe("advanceStallWatchdog", () => {
  it("drops a stall accumulated before a long hidden stretch", () => {
    // Four minutes of visible stall, then the page was away for a stretch of
    // hidden ticks. Its stall ended with it: the time it spent hidden must never
    // become visible stall on the way back.
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: 4 * 60_000,
      msSinceLastTick: STALL_TICK_MS,
      hiddenTicksBefore: STALL_HIDDEN_CARRY_TICKS + 1,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.reload).toBe(false);
    expect(next.stalledVisibleMs).toBe(STALL_TICK_MS);
  });

  it("keeps the stall across a blank of a tick or two", () => {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: 4 * 60_000,
      msSinceLastTick: STALL_TICK_MS,
      hiddenTicksBefore: STALL_HIDDEN_CARRY_TICKS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.stalledVisibleMs).toBe(4 * 60_000 + STALL_TICK_MS);
  });

  it("does not treat one throttled interval as a gap", () => {
    // Chrome throttles a hidden page's timers to one a minute; a page that is
    // merely in the background must carry its counter, not lose it.
    const next = advanceStallWatchdog({
      hidden: true,
      snapshotArrived: false,
      stalledVisibleMs: 4 * 60_000,
      hiddenTicksBefore: 0,
      msSinceLastTick: 70_000,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.stalledVisibleMs).toBe(4 * 60_000);
    expect(next.reload).toBe(false);
  });

  it("starts the stall over when the gap between ticks shows the page was away", () => {
    // Four and a half minutes of visible stall, then a gap far longer than a
    // couple of intervals (the page was suspended overnight). Coming back must
    // not be a reload half a minute later.
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: 4.5 * 60_000,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_GAP_RESET_MS + 1,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.reload).toBe(false);
    expect(next.stalledVisibleMs).toBe(0);
  });

  it("keeps counting when the ticks ran on time", () => {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: 0,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_GAP_RESET_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.stalledVisibleMs).toBe(STALL_TICK_MS);
    expect(next.reload).toBe(false);
  });

  it("carries the counter across a hidden tick instead of wiping it", () => {
    // A display that blanks for a moment must not forget a stall it had nearly
    // accumulated, and the hidden time itself must not count as stall time.
    const next = advanceStallWatchdog({
      hidden: true,
      snapshotArrived: false,
      stalledVisibleMs: 4 * 60_000,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_AFTER_MS,
    });
    expect(next).toEqual({ stalledVisibleMs: 4 * 60_000, reload: false });
  });

  it("a screen that blanks mid-stall still reloads when the stall completes", () => {
    const afterBlank = advanceStallWatchdog({
      hidden: true,
      snapshotArrived: false,
      stalledVisibleMs: 4 * 60_000,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    // One more unproductive visible tick is not enough; the next one completes it.
    const almost = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: afterBlank.stalledVisibleMs,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    const completed = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: almost.stalledVisibleMs,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(almost.reload).toBe(false);
    expect(completed.reload).toBe(true);
  });

  it("does not reload a page that has only just come back from hours hidden", () => {
    // The page was suspended; the first tick after it returns finds it visible
    // with nothing new since the previous tick. That is ONE tick, not a stall.
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: 0,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_AFTER_MS,
    });
    expect(next.reload).toBe(false);
    expect(next.stalledVisibleMs).toBe(STALL_TICK_MS);
  });

  it("does not reload while snapshots keep arriving", () => {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: true,
      stalledVisibleMs: 4 * 60_000,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_AFTER_MS,
    });
    expect(next).toEqual({ stalledVisibleMs: 0, reload: false });
  });

  it("still reloads a page that is visibly wedged for five minutes", () => {
    expect(stallFor(STALL_RELOAD_AFTER_MS).reload).toBe(true);
  });

  it("holds off while the fifteen-minute loop guard is still running", () => {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: STALL_RELOAD_AFTER_MS - STALL_TICK_MS,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS - STALL_TICK_MS,
    });
    expect(next.reload).toBe(false);
    // It stays at the threshold, so the stall is applied as soon as the gap does
    // expire, rather than five visible minutes later.
    expect(next.stalledVisibleMs).toBe(STALL_RELOAD_AFTER_MS);
  });

  it("applies the pending stall on the first tick after the gap expires", () => {
    const next = advanceStallWatchdog({
      hidden: false,
      snapshotArrived: false,
      stalledVisibleMs: STALL_RELOAD_AFTER_MS,
      hiddenTicksBefore: 0,
      msSinceLastTick: STALL_TICK_MS,
      msSinceStallReload: STALL_RELOAD_MIN_GAP_MS,
    });
    expect(next.reload).toBe(true);
    expect(next.reloadAfterVisibleMs).toBe(STALL_RELOAD_AFTER_MS + STALL_TICK_MS);
  });
});
