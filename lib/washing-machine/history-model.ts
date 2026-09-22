/**
 * The wash graph's day blocks, in local wall-clock terms.
 *
 * A block is one local day — 00:00 to 24:00 — so the graph's window is one the
 * household can name, rather than a rolling twenty-four hours that straddles two
 * of them. Wall-clock values are local date-times written as epoch ms, which is
 * what makes this DST-proof: the caller converts an instant to a wall value and
 * back (lib/power/calendar.ts), and everything here is arithmetic.
 *
 * Pure: no clock, no disk, no zone database. See specs/power-meters.md 5.2.
 */

export const WASH_BLOCK_MS = 24 * 3_600_000;

/** The block holding a wall-clock value: the local midnight it starts at. */
export function blockStartWallMs(wallMs: number) {
  return Math.floor(wallMs / WASH_BLOCK_MS) * WASH_BLOCK_MS;
}

/** A wall-clock value as the household reads it, e.g. `2:05 PM`. */
export function wallClockLabel(wallMs: number) {
  const hour24 = Math.floor(wallMs / 3_600_000) % 24;
  const minutes = Math.floor(wallMs / 60_000) % 60;
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${minutes.toString().padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** How long a wash ran, to the minute: `1h 22m`, `48m`, `2h`. */
export function washDurationLabel(durationMs: number) {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Every block a span of wall-clock time touches, oldest first.
 *
 * The walk mirrors what a block read keeps: a wash belongs to a day it really
 * overlaps (`start < day end && end > day start`), so a span that ends exactly on
 * midnight belongs to the day it ends in, and not to the one starting there —
 * which is what keeps the step list free of days with no data in them, and a step
 * never lands on an empty day. A span with no width touches nothing, for the same
 * reason: the strict overlap above is false for it.
 *
 * Capped because the span comes from stored state: an open cycle whose machine
 * sat above the start threshold for weeks would otherwise emit a block per day
 * since it began.
 */
export function blockStartsForSpan(startWallMs: number, endWallMs: number, cap = 800) {
  if (!(startWallMs < endWallMs)) return [];
  const starts: number[] = [];
  for (let at = blockStartWallMs(startWallMs); at < endWallMs && starts.length < cap; at += WASH_BLOCK_MS) {
    starts.push(at);
  }
  return starts;
}
