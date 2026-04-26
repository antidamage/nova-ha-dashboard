"use client";

import { useCallback, useEffect, useRef } from "react";

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
    const events = typeof EventSource === "undefined" ? null : new EventSource("/api/events");
    const checkWhenVisible = () => {
      if (!document.hidden) {
        checkBuild();
      }
    };
    const handleBuildEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { buildId?: string };
        handleBuildId(payload.buildId ?? "");
      } catch {
        checkBuild();
      }
    };
    const handleReloadEvent = () => {
      window.location.reload();
    };

    events?.addEventListener("build", handleBuildEvent as EventListener);
    events?.addEventListener("reload", handleReloadEvent);

    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearInterval(timer);
      events?.removeEventListener("build", handleBuildEvent as EventListener);
      events?.removeEventListener("reload", handleReloadEvent);
      events?.close();
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [checkBuild, handleBuildId]);
}
