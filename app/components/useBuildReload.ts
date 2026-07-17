"use client";

import { useCallback, useEffect, useRef } from "react";
import { subscribeToDashboardEvents } from "./sharedDashboardEvents";

// Module-level record of the newest build id this page has learned (60s
// /api/version poll or SSE "build" events, whichever lands first). Lets other
// components — the offline blocker's recovery path — decide whether a reload
// would actually pick up a new build, without re-fetching while the server is
// still coming back. Null until the first id arrives.
let lastKnownBuildId: string | null = null;

export function getLastKnownBuildId() {
  return lastKnownBuildId;
}

export function useBuildReload() {
  const currentBuildId = useRef<string | null>(null);
  const checking = useRef(false);

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

  const handleBuildId = useCallback(
    (nextBuildId: string) => {
      if (!nextBuildId) {
        return;
      }

      applyStylesheetCacheBreaker(nextBuildId);
      lastKnownBuildId = nextBuildId;

      if (currentBuildId.current === null) {
        currentBuildId.current = nextBuildId;
      } else if (currentBuildId.current !== nextBuildId) {
        window.location.reload();
      }
    },
    [applyStylesheetCacheBreaker],
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
    checkBuild();
    const timer = window.setInterval(checkBuild, 60_000);
    const checkWhenVisible = () => {
      if (!document.hidden) {
        checkBuild();
      }
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

    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkBuild, handleBuildId]);
}
