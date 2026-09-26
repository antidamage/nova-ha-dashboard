import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_RELOAD_REASON_KEY } from "../../autoReloadTelemetry";
import { resetBuildReloadStateForTests } from "../../buildReloadPolicy";
import {
  STALL_GAP_RESET_MS,
  STALL_HIDDEN_CARRY_TICKS,
  STALL_RELOAD_AFTER_MS,
  STALL_RELOAD_MIN_GAP_MS,
  STALL_TICK_MS,
  advanceStallWatchdog,
} from "./stallReload";
import { useStallReload } from "./useStallReload";

let reloads = 0;
let snapshotAt = 0;

beforeEach(() => {
  reloads = 0;
  // The document-level "a reload has been issued" flag is shared with the
  // build-change watchdog, and each test is a fresh document.
  resetBuildReloadStateForTests();
  snapshotAt = Date.now();
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    // private mode — nothing to clear
  }
  // jsdom cannot navigate; stand in a plain object so a `.reload()` call is
  // observable instead of logging "Not implemented".
  const originalLocation = window.location;
  // @ts-expect-error -- deliberately replacing the read-only global for the test
  delete window.location;
  // @ts-expect-error -- partial Location, only reload is exercised
  window.location = {
    ...originalLocation,
    reload: () => {
      reloads += 1;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** jsdom reports the document hidden/prerender by default, so tests state it. */
function setVisibility(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

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

describe("useStallReload", () => {
  it("reloads once after five unproductive visible minutes, and records why", async () => {
    vi.useFakeTimers();
    setVisibility(false);
    const fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useStallReload(() => snapshotAt));
    await vi.advanceTimersByTimeAsync(10 * STALL_TICK_MS);

    expect(reloads).toBe(1);
    expect(JSON.parse(window.sessionStorage.getItem(AUTO_RELOAD_REASON_KEY) ?? "null")).toMatchObject({
      reason: "stall",
    });
    // It reached the monitoring stream, not just this page's storage.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/events",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("does not reload a page that was hidden for the whole window", async () => {
    vi.useFakeTimers();
    setVisibility(true);
    renderHook(() => useStallReload(() => snapshotAt));
    await vi.advanceTimersByTimeAsync(20 * STALL_TICK_MS);
    expect(reloads).toBe(0);
  });

  it("does not reload once the snapshot clock is moving again", async () => {
    vi.useFakeTimers();
    setVisibility(false);
    renderHook(() => useStallReload(() => snapshotAt));
    await vi.advanceTimersByTimeAsync(9 * STALL_TICK_MS);
    snapshotAt = Date.now(); // a snapshot lands
    await vi.advanceTimersByTimeAsync(9 * STALL_TICK_MS);
    expect(reloads).toBe(0);
  });

  it("does not reload on the first visible tick after hours in the background", async () => {
    // The reported bug, end to end: the page is visible in name but suspended in
    // fact, so no tick ran and no snapshot arrived for far longer than the
    // threshold. Coming back must not reload it.
    vi.useFakeTimers();
    setVisibility(true);
    renderHook(() => useStallReload(() => snapshotAt));

    await vi.advanceTimersByTimeAsync(30 * STALL_TICK_MS); // every tick finds it hidden
    expect(reloads).toBe(0);

    setVisibility(false); // it comes back, with the clock hours stale
    await vi.advanceTimersByTimeAsync(STALL_TICK_MS);
    expect(reloads).toBe(0);
  });
});
