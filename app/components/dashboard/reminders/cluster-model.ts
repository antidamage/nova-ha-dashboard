import type { Tile } from "./types";

/** A cluster holds at most this many quarter-size icons (a 2x2 square). */
export const CLUSTER_MAX = 4;
/** A cluster only forms from at least this many icons. */
export const CLUSTER_MIN = 2;

/** A tile that may be folded into a cluster: upcoming, nothing to tap, nothing to undo. */
export function isClusterable(tile: Tile): boolean {
  return tile.state === "idle" && !tile.taskId && !tile.undoUntil && tile.order >= 0;
}

/**
 * Every upcoming tile goes into a cluster; only due, overdue, active and
 * undoable tiles stay full-size. The upcoming tiles are grouped four at a time
 * working backwards from the last, so the final cluster is the furthest away and
 * any short group is the soonest. A group of one has nothing to cluster with and
 * stays a full-size tile.
 *
 * Population order inside a cluster is top-left, bottom-left, top-right,
 * bottom-right, so each cluster lists its members soonest first and the view
 * fills it column by column.
 */
export function clusterUpcomingTiles(tiles: Tile[]): Tile[] {
  const upcoming = tiles.filter(isClusterable);
  const groups: Tile[][] = [];
  for (let end = upcoming.length; end > 0; end -= CLUSTER_MAX) {
    groups.unshift(upcoming.slice(Math.max(0, end - CLUSTER_MAX), end));
  }
  const clustered = new Set<Tile>();
  const clusters = groups
    .filter((group) => group.length >= CLUSTER_MIN)
    .map((group): Tile => {
      group.forEach((tile) => clustered.add(tile));
      return {
        ...group[0],
        key: "cluster:" + group.map((tile) => tile.key).join("|"),
        displayName: group.map((tile) => tile.displayName).join(" + "),
        members: undefined,
        cluster: group,
      };
    });
  if (clusters.length === 0) return tiles;
  return [...tiles.filter((tile) => !clustered.has(tile)), ...clusters];
}
