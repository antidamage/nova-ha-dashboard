// Sole owner of the recorder's process-wide state: the per-camera registry and
// the pause flag, both stashed on globalThis.
import type { RecorderRegistry } from "./types";

/**
 * One long-lived ffmpeg process per camera writes a rolling HLS window to disk.
 * This module owns the lifecycle: lazy start, auto-restart with backoff, retention
 * sweeping and a small status surface. It is deliberately a process-wide singleton
 * (Next dev/hot-reload re-imports modules, so the registry is stashed on
 * `globalThis`) to guarantee we never spawn two encoders for the same device.
 */

export const GLOBAL_KEY = "__novaCameraRecorders__";
export const PAUSED_KEY = "__novaCameraRecordersPaused__";

export function registry(): RecorderRegistry {
  const globalRef = globalThis as unknown as Record<string, RecorderRegistry | undefined>;
  if (!globalRef[GLOBAL_KEY]) {
    globalRef[GLOBAL_KEY] = new Map();
  }
  return globalRef[GLOBAL_KEY]!;
}

export function pausedRef(): { paused: boolean } {
  const globalRef = globalThis as unknown as Record<string, { paused: boolean } | undefined>;
  if (!globalRef[PAUSED_KEY]) {
    globalRef[PAUSED_KEY] = { paused: false };
  }
  return globalRef[PAUSED_KEY]!;
}

export function recordersPaused(): boolean {
  return pausedRef().paused;
}
