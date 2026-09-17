"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SystemBlocker } from "../SystemBlocker";
import { explicitBlockerActive } from "../systemBlockerState";
import { getLastKnownBuildId } from "../useBuildReload";
import { useAgentName } from "../AgentNameContext";
import {
  COPY,
  DEMO_MODE,
  HEALTH_URL,
  OFFLINE_MISSES_TO_BLOCK,
  POLL_MS,
  POLL_TIMEOUT_MS,
  RELOAD_MIN_BLOCKED_MS,
  STATUS_URL,
  UPDATE_STALE_MS,
} from "./constants";
import type { Mode } from "./types";

// Global, on every screen (mounted in the root layout): throws up the shared
// blocker whenever Nova is unavailable so EVERY connected display blocks during
// a restart, reboot, or update — not just the device that triggered it.
//
// It polls /api/update, which doubles as the health signal:
//   - request fails        -> Nova is offline (restart/reboot, or an update's
//                             own restart window)
//   - ok + busy (recent)   -> an update is building/switching
//   - ok + idle            -> all clear
// When it has been blocking and Nova returns idle, it decides whether to
// reload: only when the server's build actually changed while we were blocked
// (or the outage ran long enough that a fresh page is worth it anyway).
// Recovering from a transient blip — a contended box failing a couple of
// health polls — just clears the blocker in place. The unconditional
// reload-on-recovery this replaces was a major source of "the kiosk keeps
// refreshing itself".

/**
 * Release a response we are not going to read.
 *
 * An unread body keeps its data pipe — and the shared-memory descriptor behind
 * it — alive until the renderer garbage-collects the Response. This loop polls
 * twice every three seconds forever, and on the kiosk that leaked roughly twenty
 * descriptors a minute: the renderer hit its 1024-descriptor limit in under an
 * hour, stopped being able to allocate, and froze the screen. Anything here that
 * only looks at `response.ok` must drop the body explicitly.
 */
async function discardBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed, already closed, or never had a body — nothing to release.
  }
}

export function SystemActivityBlocker() {
  const { agentName } = useAgentName();
  const [mode, setMode] = useState<Mode>("clear");
  // Dismissed-for-this-outage: the blocker hides but keeps polling; it resets
  // when the outage actually ends so the next incident blocks again.
  const [dismissed, setDismissed] = useState(false);
  const dismissedRef = useRef(false);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setDismissed(true);
  }, []);

  const refresh = useCallback(() => {
    window.location.reload();
  }, []);

  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }
    let cancelled = false;
    let offlineMisses = 0;
    let blocking = false; // we have shown a blocker during this outage/update
    let blockedSince = 0; // when this outage/update began blocking
    let sawUpdating = false; // keep the "Updating" copy through its restart window
    let timer: number | undefined;

    const reloadNow = () => {
      if (!cancelled) {
        cancelled = true;
        window.location.reload();
      }
    };

    const updateIsLive = (busy: unknown, phaseAt: unknown) => {
      if (busy !== true) {
        return false;
      }
      const at = typeof phaseAt === "string" ? Date.parse(phaseAt) : NaN;
      return Number.isFinite(at) && Date.now() - at < UPDATE_STALE_MS;
    };

    const show = (next: Exclude<Mode, "clear">) => {
      // Don't double up if the page already has its own (restart/reboot) blocker.
      if (!blocking && explicitBlockerActive()) {
        return;
      }
      if (!blocking) {
        blockedSince = Date.now();
      }
      blocking = true;
      setMode(next);
    };

    const clearBlocking = () => {
      blocking = false;
      blockedSince = 0;
      sawUpdating = false;
      dismissedRef.current = false;
      setDismissed(false);
      setMode("clear");
    };

    // Nova is back and idle after a blocking episode. Reload only when it
    // buys something: the served build changed while we were blocked, we
    // never learned our own build (can't tell — old behaviour, reload), or
    // the outage ran long. A dismissed blocker never force-reloads; if the
    // build did change, useBuildReload picks it up on its own poll/SSE event.
    // Returns true when a reload was initiated (the poll loop must stop).
    const recoverFromBlocking = async () => {
      let serverBuildId: string | null = null;
      try {
        const controller = new AbortController();
        const abort = window.setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
        const response = await fetch("/api/version", { cache: "no-store", signal: controller.signal });
        window.clearTimeout(abort);
        if (!response.ok) {
          await discardBody(response);
          return false; // still flapping — keep blocking, next tick retries
        }
        const payload = (await response.json().catch(() => null)) as { buildId?: string | null } | null;
        serverBuildId = typeof payload?.buildId === "string" && payload.buildId ? payload.buildId : null;
      } catch {
        return false;
      }
      if (cancelled) {
        return true;
      }

      const knownBuildId = getLastKnownBuildId();
      const buildChanged = serverBuildId !== null && knownBuildId !== null && serverBuildId !== knownBuildId;
      const blockedLong = blockedSince > 0 && Date.now() - blockedSince >= RELOAD_MIN_BLOCKED_MS;
      if (!dismissedRef.current && (buildChanged || knownBuildId === null || blockedLong)) {
        reloadNow();
        return true;
      }

      clearBlocking();
      return false;
    };

    const tick = async () => {
      if (cancelled) {
        return;
      }
      let reachable = false;
      let updating = false;
      try {
        const controller = new AbortController();
        const abort = window.setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
        const response = await fetch(HEALTH_URL, { cache: "no-store", signal: controller.signal });
        window.clearTimeout(abort);
        reachable = response.ok;
        await discardBody(response);
      } catch {
        reachable = false;
      }
      if (cancelled) {
        return;
      }

      // Server is up — separately ask /api/update whether an update is live. This
      // is best-effort: if it fails or is slow while /api/healthz is fine, we stay
      // "clear", never "offline".
      if (reachable) {
        try {
          const controller = new AbortController();
          const abort = window.setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
          const response = await fetch(STATUS_URL, { cache: "no-store", signal: controller.signal });
          window.clearTimeout(abort);
          if (response.ok) {
            const payload = (await response.json().catch(() => null)) as
              | { busy?: boolean; phaseAt?: string | null }
              | null;
            updating = updateIsLive(payload?.busy, payload?.phaseAt);
          } else {
            await discardBody(response);
          }
        } catch {
          updating = false;
        }
        if (cancelled) {
          return;
        }
      }

      if (!reachable) {
        offlineMisses += 1;
        if (blocking || offlineMisses >= OFFLINE_MISSES_TO_BLOCK) {
          show(sawUpdating ? "updating" : "offline");
        }
      } else {
        offlineMisses = 0;
        if (updating) {
          sawUpdating = true;
          show("updating");
        } else if (blocking) {
          const reloading = await recoverFromBlocking();
          if (reloading || cancelled) {
            return;
          }
        } else {
          setMode("clear");
        }
      }

      timer = window.setTimeout(tick, POLL_MS);
    };

    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  if (mode === "clear" || dismissed) {
    return null;
  }
  return (
    <SystemBlocker
      title={COPY[mode].title.replaceAll("Nova", agentName)}
      body={COPY[mode].body.replaceAll("Nova", agentName)}
      onDismiss={dismiss}
      onRefresh={refresh}
    />
  );
}
