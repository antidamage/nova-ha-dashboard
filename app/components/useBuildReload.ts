"use client";

import { useCallback, useEffect, useRef } from "react";
import { recordAutoReload, reportDocumentLoadOnce } from "./autoReloadTelemetry";
import {
  HIDDEN_RELOAD_GRACE_MS,
  adoptRunningBuildId,
  clearPendingBuildId,
  decideBuildReload,
  getPendingBuildId,
  getRunningBuildId,
  getSupersededAgeMs,
  hasEverBeenHidden,
  hasReloadBeenIssued,
  noteHeardBuildId,
  noteHidden,
  noteReloadIssued,
  rememberPendingBuildId,
} from "./buildReloadPolicy";
import { subscribeToDashboardEvents } from "./sharedDashboardEvents";

// The wiring half of the build-reload policy: the checks, the moments a page can
// be reloaded at, and the one grace timer. What the document knows, and what
// should be done about it, is `buildReloadPolicy.ts` — re-exported below, so
// callers keep one import.
export {
  HIDDEN_RELOAD_GRACE_MS,
  decideBuildReload,
  getLastKnownBuildId,
  getPendingBuildId,
  getRunningBuildId,
  resetBuildReloadStateForTests,
  type BuildReloadDecision,
} from "./buildReloadPolicy";

export function useBuildReload() {
  const reloadTimer = useRef<number | null>(null);
  const checking = useRef(false);

  const cancelScheduledReload = useCallback(() => {
    if (reloadTimer.current !== null) {
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = null;
    }
  }, []);

  const applyStylesheetCacheBreaker = useCallback((buildId: string) => {
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href*="/_next/static/"][href*=".css"]');
    links.forEach((link) => {
      const url = new URL(link.href, window.location.href);
      if (url.searchParams.get("v") === buildId) {
        return;
      }

      url.searchParams.set("v", buildId);
      link.href = `${url.pathname}${url.search}${url.hash}`;
    });
  }, []);

  const reloadNow = useCallback(
    (nextBuildId: string) => {
      // One reload per document, whatever else is mounted: every copy of this
      // hook polls, and a visible page would otherwise reload once per copy.
      if (hasReloadBeenIssued()) {
        return;
      }
      noteReloadIssued();
      const deferredForMs = getSupersededAgeMs();
      cancelScheduledReload();
      clearPendingBuildId();
      recordAutoReload({
        reason: "build-change",
        trigger: document.hidden ? "hidden" : "visible",
        from: getRunningBuildId(),
        to: nextBuildId,
        at: Date.now(),
        // How long a page sat on a build it knew was superseded, so a display
        // that keeps deferring is visible in the record rather than silent.
        deferredForMs,
      });
      window.location.reload();
    },
    [cancelScheduledReload],
  );

  // Apply a remembered change once the page has been off-screen for the grace
  // period, and only if it still is: a hidden moment is not always a
  // backgrounding — it is also the first half of the document leaving.
  const schedulePendingReload = useCallback(() => {
    if (getPendingBuildId() === null || !document.hidden || reloadTimer.current !== null) {
      return;
    }
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null;
      const pending = getPendingBuildId();
      if (pending !== null && document.hidden) {
        reloadNow(pending);
      }
    }, HIDDEN_RELOAD_GRACE_MS);
  }, [reloadNow]);

  const handleBuildId = useCallback(
    (nextBuildId: string) => {
      if (!nextBuildId) {
        return;
      }

      if (document.hidden) {
        noteHidden();
      }
      noteHeardBuildId(nextBuildId);

      const decision = decideBuildReload({
        pageBuildId: getRunningBuildId(),
        serverBuildId: nextBuildId,
        hidden: document.hidden,
        hasBeenHidden: hasEverBeenHidden(),
      });

      if (decision === "adopt") {
        adoptRunningBuildId(nextBuildId);
      } else if (decision === "none") {
        // Back to the build we already run (a rollback, say) — nothing to defer.
        clearPendingBuildId();
        cancelScheduledReload();
      } else if (decision === "defer") {
        rememberPendingBuildId(nextBuildId);
      }

      // Only ever re-request the stylesheet of the build this page is RUNNING.
      // A release repoints the live root, so a foreign build's CSS 404s and
      // busting its cache would strip the page's styling while it waits.
      if (nextBuildId === getRunningBuildId()) {
        applyStylesheetCacheBreaker(nextBuildId);
      }

      if (decision === "reload") {
        if (document.hidden) {
          rememberPendingBuildId(nextBuildId);
          schedulePendingReload();
        } else {
          reloadNow(nextBuildId);
        }
      }
    },
    [applyStylesheetCacheBreaker, cancelScheduledReload, reloadNow, schedulePendingReload],
  );

  const checkBuild = useCallback(async () => {
    if (checking.current) {
      return;
    }

    checking.current = true;
    try {
      const response = await fetch("/api/version", { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { buildId?: string };
      handleBuildId(payload.buildId ?? "");
    } finally {
      checking.current = false;
    }
  }, [handleBuildId]);

  useEffect(() => {
    reportDocumentLoadOnce();
    checkBuild();
    const timer = window.setInterval(checkBuild, 60_000);

    const onVisibilityChange = () => {
      if (document.hidden) {
        noteHidden();
        schedulePendingReload();
        return;
      }
      // Back on screen: the person is looking at it. A scheduled reload will not
      // fire (its timer re-checks that the page is still hidden), so this is only
      // a re-check.
      checkBuild();
    };

    // A window focus with no visibility change is not a return — the kiosk gets
    // these too — so it only re-checks and stays under the same rule.
    const checkNow = () => {
      checkBuild();
    };

    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) {
        // A bfcache freeze: the page is put away to be restored later. Mark it as
        // having been away — and nothing more. Its timers cannot run while it is
        // frozen, and when it is restored it is VISIBLE again, so the change is
        // applied at its next hidden transition like any other deferral. (A
        // reload here would be a reload in front of whoever restored the page.)
        noteHidden();
        return;
      }
      // The document is leaving — a navigation the person made, or a close.
      // Never reload into that.
      cancelScheduledReload();
    };

    // NOTE: no "reload" event handler. The server used to broadcast one when
    // its BUILD_ID read changed, which mass-reloaded every screen whenever the
    // read flapped. Per-client id comparison above reloads exactly the pages
    // that are actually stale.
    const unsubscribe = subscribeToDashboardEvents({
      build: (event) => {
        try {
          const payload = JSON.parse(event.data) as { buildId?: string };
          handleBuildId(payload.buildId ?? "");
        } catch {
          checkBuild();
        }
      },
    });

    window.addEventListener("focus", checkNow);
    window.addEventListener("online", checkNow);
    window.addEventListener("pageshow", checkNow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      cancelScheduledReload();
      unsubscribe();
      window.removeEventListener("focus", checkNow);
      window.removeEventListener("online", checkNow);
      window.removeEventListener("pageshow", checkNow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelScheduledReload, checkBuild, handleBuildId, schedulePendingReload]);
}
