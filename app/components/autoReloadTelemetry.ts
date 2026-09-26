"use client";

import { emitClientEvent } from "./dashboard/emitClientEvent";

// Why this page reloaded itself, and whether the last load was the browser's
// doing rather than ours. Two readers: the page itself (sessionStorage, which
// survives its own reload) and the monitoring stream (an attributed event that
// survives the device being put down). Without this, "the dashboard reloads
// when I come back to it" cannot be attributed to the code or to the browser
// discarding the tab — Chrome Memory Saver and iOS killing a home-screen web
// app both look identical from a chair.

export const AUTO_RELOAD_REASON_KEY = "nova.dashboard.reloadReason.v1";

export type AutoReloadRecord =
  | {
      reason: "build-change";
      trigger: "hidden" | "visible";
      from: string | null;
      to: string;
      at: number;
      /** How long the change waited for the page to be off-screen, if it did. */
      deferredForMs?: number | null;
    }
  | { reason: "stall"; stalledVisibleMs: number; at: number };

/** Record and report one automatic reload, immediately before it happens. */
export function recordAutoReload(record: AutoReloadRecord): void {
  console.info("[nova-dashboard] auto reload", record);
  try {
    window.sessionStorage.setItem(AUTO_RELOAD_REASON_KEY, JSON.stringify(record));
  } catch {
    // sessionStorage unavailable (private mode, quota) — the event still stands.
  }
  emitClientEvent({
    service: "dashboard",
    event: "auto-reload",
    source: "client",
    detail: { ...record },
  });
}

let loadReported = false;

/**
 * Report once per document load what this load was: a page the browser
 * discarded and reloaded for us (`wasDiscarded`), a navigation, or this page's
 * own reload — in which case the reason it recorded a moment ago is right here.
 */
export function reportDocumentLoadOnce(): void {
  if (loadReported) {
    return;
  }
  loadReported = true;

  let previousReason: string | null = null;
  try {
    previousReason = window.sessionStorage.getItem(AUTO_RELOAD_REASON_KEY);
  } catch {
    // Unavailable — report the load without it.
  }

  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  emitClientEvent({
    service: "dashboard",
    event: "page-load",
    source: "client",
    detail: {
      navigationType: navigation?.type ?? null,
      // Chrome-only, and exactly the fact that settles "was it us or the browser".
      wasDiscarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded ?? null,
      previousAutoReload: previousReason,
    },
  });
}
