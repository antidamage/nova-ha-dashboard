export const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

// Within this many seconds of the playlist's live edge we treat playback as
// "live" and keep following it; jumping to Live seeks just behind the edge so
// hls.js always has a buffered fragment to play.
export const LIVE_EDGE_THRESHOLD_SECONDS = 8;
// Follow the live edge by sitting a few seconds BEHIND it, on fully-written,
// keyframe-aligned buffer. The previous code pinned the playhead to within 0.2s
// of the bleeding edge on every animation frame; that was fine for the synthetic
// demo clock but on the real analog capture each of those seeks lands mid-
// fragment and flashes black ~once per 2s segment — the "quick black blink".
// Instead hls.js holds the latency smoothly via maxLiveSyncPlaybackRate (it
// nudges the playback rate up when behind, no seeking), and we only ever HARD-
// seek when we've drifted so far that smooth catch-up can't recover — a genuine
// stall/gap, not normal jitter — landing on a safe target, never the edge.
export const LIVE_TARGET_LATENCY_SECONDS = 6;
export const LIVE_RESYNC_DRIFT_SECONDS = 12;
export const STATUS_POLL_MS = 15000;
// If the backend reports the device recording but hls.js never reaches
// LEVEL_LOADED within this long, the player is stuck on a dead stream — most
// often a node/container restart that left the tab's hls.js instance
// attached to a manifest that no longer resolves. Force a fresh, cache-busted
// re-attach rather than wait forever; there is no "hard refresh" affordance on
// a mobile device running this as an installed web-app, so the panel has to
// self-heal.
export const STUCK_STREAM_TIMEOUT_MS = 12000;

// Non-live (rewound) playback runs faster so you catch up to the present without
// scrubbing, then eases back to real time as you approach the live edge. Above
// FAST_PLAYBACK_THRESHOLD_SECONDS behind live we play at FAST_PLAYBACK_RATE;
// within it we return to 1x. (Live-follow keeps 1x — hls.js does its own gentle
// rate-nudging there via maxLiveSyncPlaybackRate.)
export const FAST_PLAYBACK_RATE = 1.5;
export const FAST_PLAYBACK_THRESHOLD_SECONDS = 60;
