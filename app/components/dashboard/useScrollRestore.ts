"use client";

import { useEffect, useRef } from "react";
import { isHorizontalDashboard } from "./useClickDragScroll";

// Restores the window scroll position across reloads. The dashboard's content
// extent depends on async state (zones/panels render after the first
// snapshot), so the browser's native restoration can't work: at restore time
// the page is still short. This hook saves the offset as the user scrolls and
// replays it once the dashboard reports real content, waiting for the layout
// to grow large enough (bounded by a timeout). Any user scroll input while a
// restore is pending cancels it — the user wins.

const scrollStorageKey = () => isHorizontalDashboard() ? "nova.dashboard.scrollX.v1" : "nova.dashboard.scrollY.v1";
const RESTORE_TIMEOUT_MS = 3_000;

function readStoredScroll(): number | null {
  try {
    const raw = window.localStorage.getItem(scrollStorageKey());
    if (raw === null) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function useScrollRestore(ready: boolean) {
  // Until the saved offset has been replayed (or abandoned), scroll events
  // must not overwrite it — the pre-restore page sits at 0.
  const restoreDoneRef = useRef(false);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    let raf = 0;
    const onScroll = () => {
      if (raf || !restoreDoneRef.current) {
        return;
      }
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        try {
          window.localStorage.setItem(scrollStorageKey(), String(Math.round(isHorizontalDashboard() ? window.scrollX : window.scrollY)));
        } catch {
          // Storage denied — scroll restore silently degrades.
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, []);

  useEffect(() => {
    if (!ready || restoreDoneRef.current) {
      return;
    }

    const target = readStoredScroll();
    if (target === null || target <= 0) {
      restoreDoneRef.current = true;
      return;
    }

    const startedAt = Date.now();
    let raf = 0;
    const finish = () => {
      restoreDoneRef.current = true;
      window.removeEventListener("wheel", cancelOnUserInput);
      window.removeEventListener("touchstart", cancelOnUserInput);
      window.removeEventListener("keydown", cancelOnUserInput);
    };
    const cancelOnUserInput = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      finish();
    };
    const attempt = () => {
      raf = 0;
      const horizontal = isHorizontalDashboard();
      const maxScroll = horizontal
        ? document.documentElement.scrollWidth - window.innerWidth
        : document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll >= target) {
        // Restore is an explicit instant jump so it never animates on reload.
        window.scrollTo({ top: horizontal ? 0 : target, left: horizontal ? target : 0, behavior: "instant" });
        finish();
        return;
      }
      if (Date.now() - startedAt > RESTORE_TIMEOUT_MS) {
        // Content never grew tall enough (layout changed since the save) —
        // land as deep as the page allows rather than jumping later.
        window.scrollTo({ top: horizontal ? 0 : Math.max(0, maxScroll), left: horizontal ? Math.max(0, maxScroll) : 0, behavior: "instant" });
        finish();
        return;
      }
      raf = window.requestAnimationFrame(attempt);
    };

    window.addEventListener("wheel", cancelOnUserInput, { passive: true });
    window.addEventListener("touchstart", cancelOnUserInput, { passive: true });
    window.addEventListener("keydown", cancelOnUserInput);
    raf = window.requestAnimationFrame(attempt);
    return () => {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      window.removeEventListener("wheel", cancelOnUserInput);
      window.removeEventListener("touchstart", cancelOnUserInput);
      window.removeEventListener("keydown", cancelOnUserInput);
    };
  }, [ready]);
}
