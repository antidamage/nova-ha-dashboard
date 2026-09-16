// Restart, retention and self-heal timings.

export const RESTART_MIN_DELAY_MS = 1000;
export const RESTART_MAX_DELAY_MS = 15000;
export const RETENTION_SWEEP_MS = 60 * 1000;
// The self-heal supervisor cadence. It re-resolves the source (demo-clock ->
// real device once the device reappears), detects a "burst-then-stall" device
// (ffmpeg alive but no fresh segments), and clears a stale lastError once the
// current generation is confirmed healthy.
export const SUPERVISE_MS = 8 * 1000;
// A freshly (re)spawned encoder needs a moment before its first segment lands;
// don't judge it stalled inside this warmup.
export const WARMUP_MS = 20 * 1000;
// A running device encoder that hasn't written a segment in this long is wedged
// (the classic MS2109 burst-then-stall keeps ffmpeg alive with zero output).
export const STALL_MS = 25 * 1000;
// Don't thrash the demo->device re-resolve or stall-restart faster than this.
export const SELF_HEAL_MIN_INTERVAL_MS = 20 * 1000;
// Segments this fresh (ms) mean the current encoder is genuinely healthy.
export const FRESH_SEGMENT_MS = STALL_MS;
