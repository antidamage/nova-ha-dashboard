import { FAST_PLAYBACK_RATE, FAST_PLAYBACK_THRESHOLD_SECONDS, LIVE_TARGET_LATENCY_SECONDS, OLDEST_POSITION_MARGIN_SECONDS, OLDEST_POSITION_RESCUE_SECONDS } from "./constants";

/**
 * The jog dial's stops, in dial order: whole rates, plus 0.5x each side of a
 * standstill. There is no 0 stop, because stopping is what the dial's tap does.
 */
export const JOG_STOPS: readonly number[] = [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Where the dial rests when no jog is set: real time. */
export const JOG_DEFAULT_RATE = 1;

export function jogStopIndex(rate: number): number {
  let best = 0;
  JOG_STOPS.forEach((stop, index) => {
    if (Math.abs(stop - rate) < Math.abs(JOG_STOPS[best] - rate)) best = index;
  });
  return best;
}

export function jogRateAt(index: number): number {
  return JOG_STOPS[Math.min(Math.max(Math.round(index), 0), JOG_STOPS.length - 1)];
}

export function formatJogRate(rate: number): string {
  return `${rate < 0 ? "−" : ""}${Math.abs(rate)}x`;
}

/**
 * Forward playback's rate. A set jog is obeyed as it stands; with none set,
 * rewound playback keeps its catch-up rule (constants.ts).
 */
export function forwardPlaybackRate(jog: number | null, behindSeconds: number): number {
  if (jog !== null) return jog;
  return behindSeconds > FAST_PLAYBACK_THRESHOLD_SECONDS ? FAST_PLAYBACK_RATE : JOG_DEFAULT_RATE;
}

/**
 * A faster-than-real-time jog cannot stay ahead of the recording. Once it has
 * caught the place Live sits, playback goes live and the jog ends.
 */
export function jogReachedLiveEdge(jog: number | null, behindSeconds: number): boolean {
  return jog !== null && jog > 1 && behindSeconds <= LIVE_TARGET_LATENCY_SECONDS;
}

/**
 * One backward step: `<video>` cannot play in reverse, so a negative jog seeks.
 * The step covers all the time since the last one, so a slow seek shows fewer
 * frames rather than a slower rate.
 */
export function reverseStep(
  currentTime: number,
  rate: number,
  elapsedSeconds: number,
  rangeStart: number,
): { time: number; atStart: boolean } {
  const time = currentTime + rate * elapsedSeconds;
  return time <= rangeStart ? { time: rangeStart, atStart: true } : { time, atStart: false };
}

/**
 * The oldest position worth asking for. `playlistStart` is the oldest segment still
 * in the live playlist, where the player knows it; otherwise `seekableStart` is real.
 */
export function oldestSafePosition(seekableStart: number, seekableEnd: number, playlistStart?: number | null): number {
  return Math.min(Math.max(seekableStart, playlistStart ?? seekableStart) + OLDEST_POSITION_MARGIN_SECONDS, seekableEnd);
}

/** Playback the deleting window has nearly caught, where `oldest` is oldestSafePosition. */
export function overtakenByWindow(currentTime: number, oldest: number): boolean {
  return currentTime < oldest - OLDEST_POSITION_MARGIN_SECONDS + OLDEST_POSITION_RESCUE_SECONDS;
}
