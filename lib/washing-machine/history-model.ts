/**
 * The wash graph's 12-hour blocks, in local wall-clock terms.
 *
 * A block is half a local day — 00:00–12:00 and 12:00–24:00 — so the graph's
 * window is one the household can name, rather than a rolling twelve hours that
 * straddles two of them. Wall-clock values are local date-times written as epoch
 * ms, which is what makes this DST-proof: the caller converts an instant to a
 * wall value and back (lib/power/calendar.ts), and everything here is arithmetic.
 *
 * Pure: no clock, no disk, no zone database. See specs/power-meters.md 5.2.
 */

export const WASH_BLOCK_MS = 12 * 3_600_000;

/** The block holding a wall-clock value: its own start. */
export function blockStartWallMs(wallMs: number) {
  return Math.floor(wallMs / WASH_BLOCK_MS) * WASH_BLOCK_MS;
}

/**
 * Every block a span of wall-clock time touches, oldest first.
 *
 * The walk mirrors what a block read keeps: a wash belongs to a block it really
 * overlaps (`start < block end && end > block start`), so a span that ends
 * exactly on a boundary belongs to the block it ends in, and not to the one
 * starting there — which is what keeps the step list free of blocks with no data
 * in them, and a step never lands on an empty block.
 *
 * Capped because the span comes from stored state: an open cycle whose machine
 * sat above the start threshold for weeks would otherwise emit a block per
 * half-day since it began.
 */
export function blockStartsForSpan(startWallMs: number, endWallMs: number, cap = 800) {
  const starts: number[] = [];
  for (let at = blockStartWallMs(startWallMs); at < endWallMs && starts.length < cap; at += WASH_BLOCK_MS) {
    starts.push(at);
  }
  return starts;
}
