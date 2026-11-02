/**
 * Smoothing from a position rather than live: where a stream should start, and which
 * moment of it matches the recording. specs/camera-smooth-delivery.md.
 */

/** The rates the pipeline can bring to 60 fps. Faster ones already reach it from the source. */
export type SmoothRate = 0.5 | 1;

const SMOOTH_SEGMENT_SECONDS = 1;
// Starting the pipeline takes about 5 s and its first segment one more. The stream only
// ever runs in real time, so what it has made by the handoff is all the margin it gets.
const SMOOTH_LEAD_SECONDS = 10;

export function smoothRateFor(rate: number): SmoothRate | null {
  return rate === 0.5 || rate === 1 ? rate : null;
}

export type BaseFragment = { start: number; programDateTime?: number | null };

/** The first fragment boundary the stream has time to be ready by, or null if none is left. */
export function handoffFragment<T extends BaseFragment>(fragments: readonly T[], currentTime: number, rate: SmoothRate): T | null {
  const earliest = currentTime + SMOOTH_LEAD_SECONDS * rate;
  return fragments.find((fragment) => fragment.start >= earliest) ?? null;
}

/**
 * Where in the smooth stream the recording's `baseTime` falls. One second of stream
 * covers `rate` seconds of footage. `firstSequence` and `firstStart` describe the
 * stream's oldest listed segment, as its segments are numbered from the stream's start.
 */
export function smoothStreamTime(baseTime: number, handoffStart: number, rate: SmoothRate, firstSequence: number, firstStart: number): number {
  const sinceStreamStart = (baseTime - handoffStart) / rate;
  return firstStart + sinceStreamStart - firstSequence * SMOOTH_SEGMENT_SECONDS;
}

/** How far the recording may run past the handoff with nothing to show before giving up. */
export const SMOOTH_MISSED_HANDOFF_SECONDS = 12;
/** More apart than this, the two are not showing the same moment, so the stream is moved. */
export const SMOOTH_MAX_DRIFT_SECONDS = 0.5;
/** Moving it is not free, so it is moved at most this often. */
export const SMOOTH_CORRECTION_INTERVAL_MS = 2000;
/** This far behind, the stream has fallen out of step, and the recording takes over. */
export const SMOOTH_GIVE_UP_DRIFT_SECONDS = 4;
