"use client";

import type { Mode } from "./types";

export const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
// Liveness is a dedicated minimal endpoint (no HA/GitHub/FS) so a slow /api/update
// can never read as "Nova offline". /api/update is now only consulted, best-effort,
// to decide the "Updating Nova" phase once we know the server is reachable.
export const HEALTH_URL = "/api/healthz";
export const STATUS_URL = "/api/update";
export const POLL_MS = 3_000;
// Slightly more generous abort than the old 3.5s: /api/update is only a few local
// file reads, so a slow answer means the box is briefly contended (ffmpeg/HLS
// pegging CPU, or the HTTP/1.1 connection pool saturated by the SSE streams +
// camera segments), NOT that Nova is down. 3.5s was tight enough that a transient
// stall read as an outage; 5s rides those out. A genuine restart fails the fetch
// fast (connection refused), so this doesn't slow detection of a real outage.
export const POLL_TIMEOUT_MS = 5_000;
// Ride out a brief blip before blocking from a clear state; once already blocking,
// a single miss keeps it up (that's the real restart window).
export const OFFLINE_MISSES_TO_BLOCK = 2;
// A "busy" update phase older than this is treated as a wedged/dead updater, not
// a live update, so a stuck state.json can never trap every screen forever.
export const UPDATE_STALE_MS = 15 * 60_000;
// An outage that ran at least this long gets a reload on recovery even when the
// build is unchanged — long enough that page state (SSE backlog, stale panels)
// is worth resetting, and a long-fuse escape hatch for a half-wedged renderer.
export const RELOAD_MIN_BLOCKED_MS = 10 * 60_000;

export const COPY: Record<Exclude<Mode, "clear">, { title: string; body: string }> = {
  offline: {
    title: "Reconnecting to Nova",
    body: "Nova is restarting or temporarily offline. This screen will reconnect automatically as soon as it's back.",
  },
  updating: {
    title: "Updating Nova",
    body: "A new version is being installed. The dashboard will reconnect and reload automatically once it's ready.",
  },
};
