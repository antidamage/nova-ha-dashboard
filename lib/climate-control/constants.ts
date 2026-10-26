export const POLL_MS = 5_000;
export const COMMAND_SETTLE_MS = 12_000;
/**
 * The Gree reports a command back slowly and sometimes in two steps, and a change
 * that lands after the settle window reads as someone using the remote: Nova
 * stands down and the selected mode appears to be lost. The aircon waits longer.
 */
export const AIRCON_COMMAND_SETTLE_MS = 45_000;
/** How long, and how often, an Off the unit has not obeyed is sent again. */
export const OFF_RESEND_WINDOW_MS = 2 * 60_000;
export const OFF_RESEND_EVERY_MS = 10_000;
export const OFF_RESEND_MAX = 8;
export const AIRCON_SAME_DIRECTION_RESUME_DRIFT_C = 1;
/**
 * Aggressive's band: the sensor reads whole degrees, so half a degree is the
 * first reading past the target. Normal Manual waits for a full degree.
 */
export const AIRCON_AGGRESSIVE_RESUME_DRIFT_C = 0.5;
/**
 * Aggressive's compressor dwell. The sensor reads whole degrees, so the smaller
 * band alone restarts on the same reading as the normal one; the dwell is what
 * is left to wait for. Three minutes is the usual minimum compressor off-time,
 * and the Gree enforces its own in firmware regardless
 * (specs/aircon-auto-control.md §3.1, §9).
 */
export const AIRCON_AGGRESSIVE_MIN_OFF_MS = 3 * 60_000;
export const AIRCON_MIN_OFF_MS = 10 * 60_000;
export const AIRCON_START_WINDOW_MS = 60 * 60_000;
