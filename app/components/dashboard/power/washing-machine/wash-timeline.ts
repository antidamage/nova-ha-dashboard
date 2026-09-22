// The wash graph's pure shapes: where a wash sits across its block, and which
// block a step lands on. No React, no disk. See specs/power-meters.md 5.2.
import type { PowerWashingMachineSummary, WashBlock, WashGraphCycle } from "../../../../../lib/power";

/**
 * A tap target first and a bar second: a block narrower than this cannot be
 * tapped on a kiosk, and every block here exists to be tapped. Percentages are
 * of the block on show.
 */
export const MIN_WASH_BLOCK_PERCENT = 14;

/**
 * How much of the graph one start-and-duration label needs, so its row can be
 * decided without measuring text. Percentages are of the day on show.
 *
 * Measured on the live card: `3:04 PM · 1h 13m` is 69 px wide on a 264 px strip
 * (26%). A wider theme face fits fewer characters per pixel, so the reservation
 * covers the longest label the format can produce instead — about 95 px on the
 * narrowest strip the card reaches (~250 px at a 300 px card). The cost is a row
 * only where two washes are more than about eight hours apart.
 */
export const WASH_LABEL_WIDTH_PERCENT = 36;

/** How tall one row of wash labels is, in px. The graph reserves a row each. */
export const WASH_LABEL_ROW_PX = 15;

/** Percentages are style strings, so they are settled here rather than in the DOM. */
function percent(value: number) {
  return Number(value.toFixed(3));
}

/** A configured person's colour, or the neutral the surface uses for unassigned. */
export function personColor(people: PowerWashingMachineSummary["people"], person: string | null) {
  return people.find((candidate) => candidate.id === person)?.color ?? "var(--cyber-line, #52525b)";
}

/**
 * Where a wash sits across the block on show, as percentages of its width. A wash
 * that runs over a boundary (11:50 to 12:40) is drawn clipped in both blocks, and
 * one close to the end keeps its touch width by pulling its left edge in.
 */
export function washPlacement(cycle: WashGraphCycle, window: WashBlock) {
  const span = Math.max(1, window.endMs - window.startMs);
  const start = ((Date.parse(cycle.startedAt) - window.startMs) / span) * 100;
  const end = ((Date.parse(cycle.endedAt) - window.startMs) / span) * 100;
  const width = Math.min(100, Math.max(MIN_WASH_BLOCK_PERCENT, end - start));
  return { left: percent(Math.max(0, Math.min(start, 100 - width))), width: percent(width) };
}

/**
 * Where each wash's own label sits under the graph: how far across, and which row.
 *
 * A label is centred on the block it belongs to and kept inside the graph's own
 * edges. Rows are handed out left to right, so two washes close together — two
 * loads an hour apart, which is ordinary here — do not draw over each other: a
 * label that would overlap the last one already on a row drops to the next row
 * down. The blocks are laid out in the order they are given.
 */
export function washLabelPlacement(cycles: WashGraphCycle[], window: WashBlock) {
  const half = WASH_LABEL_WIDTH_PERCENT / 2;
  // The right-hand edge of the last label placed on each row.
  const rowEdges: number[] = [];
  const labels = cycles.map((cycle) => {
    const { left, width } = washPlacement(cycle, window);
    const across = Math.max(half, Math.min(left + width / 2, 100 - half));
    let row = rowEdges.findIndex((edge) => across - half >= edge);
    if (row === -1) row = rowEdges.length;
    rowEdges[row] = across + half;
    return { across: percent(across), cycle, row };
  });
  return { labels, rows: Math.max(1, rowEdges.length) };
}

/**
 * Where one step of the graph lands.
 *
 * `blocks` is every block holding a wash, oldest first, so a step never lands on
 * a block with no data in it. A `cursor` of `null` means the graph is on its
 * newest block and following the poll; the newest block is returned as `null`
 * again, and `undefined` means there is nothing that way, so the button is
 * disabled.
 */
export function washStep(
  blocks: number[],
  cursor: number | null,
  direction: -1 | 1,
): number | null | undefined {
  const list = [...new Set(blocks)].sort((a, b) => a - b);
  const from = cursor === null ? list.length - 1 : list.indexOf(cursor);
  if (from < 0) return undefined;
  const target = list[from + direction];
  if (target === undefined) return undefined;
  return target === list[list.length - 1] ? null : target;
}
