"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardState } from "../../../../lib/types";
import { subscribeToDashboardEvents } from "../../sharedDashboardEvents";
import { isControlInteractionCoolingDown } from "../../controlInteractionCooldown";
import { emitClientEvent } from "../emitClientEvent";
import { arePageUpdatesPaused, subscribePageUpdatePause } from "../pageUpdatePause";
import { fetchDashboardStateSnapshot } from "./client";
import { useStallReload } from "./useStallReload";
import type { LoadState } from "./types";

export function useDashboardState() {
  const [data, setData] = useState<DashboardState | null>(null);
  const [status, setStatus] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pollingPausedUntil = useRef(0);
  const eventStreamConnected = useRef(false);
  const eventClientId = useRef<number | null>(null);
  // Last time a server snapshot actually reached us via ANY path (initial load,
  // background poll, explicit refresh, SSE push). Feeds the stall-reload
  // watchdog below; seeded with mount time so a fresh page gets the full grace
  // period before it may conclude it is wedged.
  const lastSnapshotAt = useRef(Date.now());
  const getLastSnapshotAt = useCallback(() => lastSnapshotAt.current, []);
  const hasDashboardData = useRef(false);
  const pendingScrollSnapshot = useRef<DashboardState | null>(null);

  // Server updates are non-urgent during a scroll. Keep receiving them so the
  // connection stays healthy, but collapse them to the newest snapshot and
  // avoid a large dashboard reconciliation on the input-critical path.
  const commitServerSnapshot = useCallback((payload: DashboardState) => {
    if (arePageUpdatesPaused() && hasDashboardData.current) {
      pendingScrollSnapshot.current = payload;
      return;
    }
    pendingScrollSnapshot.current = null;
    hasDashboardData.current = true;
    setData(payload);
  }, []);

  useEffect(() => subscribePageUpdatePause((paused) => {
    if (paused || !pendingScrollSnapshot.current) return;
    const payload = pendingScrollSnapshot.current;
    pendingScrollSnapshot.current = null;
    hasDashboardData.current = true;
    setData(payload);
  }), []);

  // Every real device doubles as an outage probe: when a snapshot finally lands
  // after a long gap, report how long the client was cut off. These attributed
  // events flow into the monitoring stream and are the only external evidence
  // of "nova was unreachable from the LAN" episodes that leave no server-side
  // trace (WiFi path drops, wedged connections). Fire-and-forget; never blocks.
  const CLIENT_GAP_REPORT_MS = 60_000;
  const markSnapshotArrived = useCallback(() => {
    const previousAt = lastSnapshotAt.current;
    const nowMs = Date.now();
    lastSnapshotAt.current = nowMs;
    const gapMs = nowMs - previousAt;
    if (gapMs >= CLIENT_GAP_REPORT_MS) {
      emitClientEvent({
        service: "network",
        event: "client-connection-gap",
        source: "client",
        detail: { gapMs, gapSeconds: Math.round(gapMs / 1000) },
      });
    }
  }, []);

  // === POLLING COOLDOWN CONTRACT — DO NOT REMOVE (regressed 3x by refactors) ===
  // After a user changes an entity (temperature, on/off, brightness, etc.) the UI is
  // updated optimistically. Home Assistant takes up to a second or two to actually
  // apply the change and echo it back, so any state we poll/receive during that window
  // still carries the OLD value. If we let that stale snapshot overwrite the optimistic
  // value the user sees the control briefly snap back to the previous value and then
  // jump to the correct value once HA catches up — the exact "revert then re-update"
  // flicker we are guarding against.
  //
  // `pausePolling(ms)` sets a deadline; EVERY code path that pushes a *server* snapshot
  // into `setData` MUST honour it (see `refresh`, the background poll loop, the SSE
  // handler and server-owned climate controller). `isPollingPaused()` is the shared predicate for
  // callers that fetch outside of `refresh`. If you add a new poller, gate its `setData`
  // on `isPollingPaused()` or you WILL reintroduce the flicker.
  const pausePolling = useCallback((durationMs: number) => {
    pollingPausedUntil.current = Math.max(pollingPausedUntil.current, Date.now() + durationMs);
  }, []);

  // True while a user-initiated command cooldown is still active. Callers that fetch a
  // server snapshot outside of `refresh` must check this before calling `setData`.
  const isPollingPaused = useCallback(
    () => isControlInteractionCoolingDown() || Date.now() < pollingPausedUntil.current,
    [],
  );

  const refresh = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    // Cooldown guard — see POLLING COOLDOWN CONTRACT above. `force` is only for explicit
    // user-driven refreshes that should bypass the cooldown.
    if (isControlInteractionCoolingDown() || (!force && Date.now() < pollingPausedUntil.current)) {
      return null;
    }
    if (force) {
      pollingPausedUntil.current = 0;
    }

    const requestStartedAt = Date.now();
    setStatus((current) => (current === "idle" ? "loading" : current));
    const payload = await fetchDashboardStateSnapshot();
    markSnapshotArrived();
    if (isControlInteractionCoolingDown() || (!force && pollingPausedUntil.current > requestStartedAt)) {
      setStatus("idle");
      return null;
    }
    commitServerSnapshot(payload);
    setError(null);
    setStatus("idle");
    return payload;
  }, []);

  useEffect(() => {
    let alive = true;
    // One snapshot request at a time: a slow request must not let the 5s tick
    // stack further connections behind it (see SNAPSHOT_FETCH_TIMEOUT_MS — the
    // per-origin pool is the scarce resource being protected).
    let loadInFlight = false;

    async function load({ force = false, initial = false }: { force?: boolean; initial?: boolean } = {}) {
      // Background poll loop — honours the command cooldown (POLLING COOLDOWN CONTRACT above).
      if (loadInFlight) {
        return;
      }
      if (isControlInteractionCoolingDown() || (!force && Date.now() < pollingPausedUntil.current)) {
        return;
      }
      if (force) {
        pollingPausedUntil.current = 0;
      }

      loadInFlight = true;
      try {
        if (initial) {
          setStatus("loading");
        }
        const requestStartedAt = Date.now();
        const payload = await fetchDashboardStateSnapshot();
        markSnapshotArrived();
        if (isControlInteractionCoolingDown() || (!force && pollingPausedUntil.current > requestStartedAt)) {
          return;
        }
        if (alive) {
          commitServerSnapshot(payload);
          setError(null);
          setStatus("idle");
        }
      } catch (err) {
        // Show the error and keep polling — no reload. Reloading here used to
        // fire after just 8s of failed fetches, which turned every transient
        // stall (contended box) and every HA outage (/api/state 500s while the
        // dashboard itself is fine) into a reload loop. Real dashboard outages
        // are covered by SystemActivityBlocker, and stale-build pickup by
        // useBuildReload.
        if (alive) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard state");
          setStatus("error");
        }
      } finally {
        loadInFlight = false;
      }
    }

    load({ force: true, initial: true });
    const timer = window.setInterval(() => {
      load();
    }, 5000);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        load({ force: true });
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const unsubscribe = subscribeToDashboardEvents({
      open: () => {
        eventStreamConnected.current = true;
      },
      error: () => {
        eventStreamConnected.current = false;
      },
      "client-id": (event) => {
        try {
          const payload = JSON.parse(event.data) as { id?: unknown };
          const id = Number(payload.id);
          eventClientId.current = Number.isInteger(id) && id > 0 ? id : null;
        } catch {
          eventClientId.current = null;
        }
      },
      state: (event) => {
        // A state push arriving proves the pipeline is alive even when the
        // cooldown below declines to apply it — count it for the stall watchdog.
        markSnapshotArrived();
        // SSE-pushed snapshots also honour the command cooldown (POLLING COOLDOWN CONTRACT
        // above): a server push right after a user command still carries HA's stale state.
        if (isControlInteractionCoolingDown() || Date.now() < pollingPausedUntil.current) {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as DashboardState;
          commitServerSnapshot(payload);
          setError(null);
          setStatus("idle");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to read dashboard event");
        }
      },
    });

    return () => {
      eventStreamConnected.current = false;
      eventClientId.current = null;
      unsubscribe();
    };
  }, []);

  // The stall watchdog reads the same snapshot clock this hook feeds from the
  // poll loop and the SSE handler; it lives in its own module (and its own
  // test) because its rule is "visible time only" and that rule is the point.
  useStallReload(getLastSnapshotAt);

  return { data, status, error, eventClientId, setData, refresh, pausePolling, isPollingPaused };
}
