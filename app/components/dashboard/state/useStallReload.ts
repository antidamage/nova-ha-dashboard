"use client";

import { useEffect, useRef } from "react";
import { recordAutoReload } from "../../autoReloadTelemetry";
import {
  STALL_RELOAD_AFTER_MS,
  STALL_RELOAD_STAMP_KEY,
  STALL_TICK_MS,
  advanceStallWatchdog,
} from "./stallReload";

/**
 * Last-resort reload for a page that is VISIBLY wedged. The threshold and the
 * reason it cannot count hidden time live in `./stallReload`; this hook owns the
 * interval, the loop-protection stamp and the shared snapshot clock (the poll
 * loop and the SSE handler both feed `getLastSnapshotAt`).
 *
 * Deliberately not gated on the build watchdog's "a reload has been issued" flag:
 * that flag is latched for the life of the document, and this watchdog exists for
 * the case where the page did NOT recover, so a reload that never landed must not
 * be able to disable it. Its own fifteen-minute stamp is what bounds repeats.
 */
export function useStallReload(getLastSnapshotAt: () => number) {
  const lastSnapshotSeenAt = useRef<number | null>(null);
  const lastTickAt = useRef<number | null>(null);
  const hiddenTicks = useRef(0);
  const stalledVisibleMs = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const nowMs = Date.now();
      const snapshotAt = getLastSnapshotAt();
      const snapshotArrived =
        lastSnapshotSeenAt.current !== null && snapshotAt !== lastSnapshotSeenAt.current;
      // A null here is the first tick of a fresh page: one ordinary interval.
      const msSinceLastTick = lastTickAt.current === null ? STALL_TICK_MS : nowMs - lastTickAt.current;
      lastSnapshotSeenAt.current = snapshotAt;
      lastTickAt.current = nowMs;

      let lastReloadAt = 0;
      try {
        lastReloadAt = Number(window.localStorage.getItem(STALL_RELOAD_STAMP_KEY)) || 0;
      } catch {
        // Storage unavailable — still reload, just without loop protection.
      }

      const next = advanceStallWatchdog({
        hidden: document.hidden,
        snapshotArrived,
        stalledVisibleMs: stalledVisibleMs.current,
        msSinceLastTick,
        hiddenTicksBefore: hiddenTicks.current,
        msSinceStallReload: nowMs - lastReloadAt,
      });
      hiddenTicks.current = document.hidden ? hiddenTicks.current + 1 : 0;
      stalledVisibleMs.current = next.stalledVisibleMs;
      if (!next.reload) {
        return;
      }

      try {
        window.localStorage.setItem(STALL_RELOAD_STAMP_KEY, String(Date.now()));
      } catch {
        // Ignore: reloading matters more than stamping.
      }
      recordAutoReload({
        reason: "stall",
        stalledVisibleMs: next.reloadAfterVisibleMs ?? STALL_RELOAD_AFTER_MS,
        at: Date.now(),
      });
      window.location.reload();
    }, STALL_TICK_MS);

    return () => window.clearInterval(timer);
  }, [getLastSnapshotAt]);
}
