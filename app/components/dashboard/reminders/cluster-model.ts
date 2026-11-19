import type { Tile } from "./types";

/** A cluster holds at most this many quarter-size icons (a 2x2 square). */
export const CLUSTER_MAX = 4;
/** A cluster only forms when at least this many icons overflow. */
export const CLUSTER_MIN = 2;

/** A tile that may be folded into the cluster: upcoming, nothing to tap, nothing to undo. */
export function isClusterable(tile: Tile): boolean {
  return tile.state === "idle" && !tile.taskId && !tile.undoUntil && tile.order >= 0;
}

/**
 * How many tiles fit in one row of `width` px. Null when nothing can be measured
 * yet, which leaves the bar unclustered.
 */
export function rowCapacity(width: number, tileSize: number, gap: number): number | null {
  if (!(width > 0) || !(tileSize > 0)) return null;
  return Math.max(1, Math.floor((width + gap) / (tileSize + gap)));
}

/**
 * When the tiles overflow a row of `capacity`, the last upcoming ones become one
 * cluster tile, which takes the room of a single full-size tile. Only the tiles
 * that actually overflow are taken (the cluster itself needs a slot, so one more
 * than the overflow), at most four, and never fewer than two. Active, due,
 * overdue and undoable tiles always stay full-size.
 *
 * Population order is top-left, bottom-left, top-right, bottom-right, so the
 * cluster lists its members soonest first and the view fills it column by column.
 */
export function clusterOverflowTiles(tiles: Tile[], capacity: number | null): Tile[] {
  if (capacity === null || tiles.length <= capacity) return tiles;
  const wanted = Math.min(CLUSTER_MAX, tiles.length - capacity + 1);
  const eligible = tiles.filter(isClusterable);
  const taken = eligible.slice(-Math.min(wanted, eligible.length));
  if (taken.length < CLUSTER_MIN) return tiles;
  const kept = tiles.filter((tile) => !taken.includes(tile));
  const first = taken[0];
  return [
    ...kept,
    {
      ...first,
      key: "cluster:" + taken.map((tile) => tile.key).join("|"),
      displayName: taken.map((tile) => tile.displayName).join(" + "),
      members: undefined,
      cluster: taken,
    },
  ];
}
