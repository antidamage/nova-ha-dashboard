import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_RELOAD_REASON_KEY } from "../../autoReloadTelemetry";
import { resetBuildReloadStateForTests } from "../../buildReloadPolicy";
import { STALL_TICK_MS } from "./stallReload";
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
