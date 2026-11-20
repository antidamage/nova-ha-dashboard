import { describe, expect, it } from "vitest";

import { clusterUpcomingTiles } from "./cluster-model";
import type { Tile } from "./types";

function tile(key: string, state: Tile["state"] = "idle", extra: Partial<Tile> = {}): Tile {
  return {
    key,
    displayName: key,
    glyph: { kind: "text", value: key },
    state,
    taskId: state === "idle" ? null : key,
    undoUntil: null,
    nextDueMs: 1,
    order: 0,
    ...extra,
  };
}

const keys = (tiles: Tile[]) => tiles.map((entry) => entry.key);
const members = (cluster: Tile) => cluster.cluster?.map((part) => part.key);

describe("clusterUpcomingTiles", () => {
  it("clusters every upcoming tile, leaving only due ones full-size", () => {
    const result = clusterUpcomingTiles([tile("due", "due"), tile("late", "overdue"), tile("a"), tile("b"), tile("c")]);
    expect(keys(result).slice(0, 2)).toEqual(["due", "late"]);
    expect(result).toHaveLength(3);
    expect(members(result[2])).toEqual(["a", "b", "c"]);
  });

  it("fills four at a time working backwards, leaving the soonest group short", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((key) => tile(key));
    const result = clusterUpcomingTiles(many);
    expect(result).toHaveLength(3);
    expect(result.map(members)).toEqual([["a", "b"], ["c", "d", "e", "f"], ["g", "h", "i", "j"]]);
  });

  it("leaves a lone upcoming tile full-size", () => {
    const tiles = [tile("due", "due"), tile("only")];
    expect(clusterUpcomingTiles(tiles)).toBe(tiles);
    const five = ["a", "b", "c", "d", "e"].map((key) => tile(key));
    const result = clusterUpcomingTiles(five);
    expect(keys(result)[0]).toBe("a");
    expect(members(result[1])).toEqual(["b", "c", "d", "e"]);
  });

  it("never clusters undoable tiles", () => {
    const result = clusterUpcomingTiles([tile("undo", "idle", { undoUntil: 5 }), tile("x"), tile("y")]);
    expect(keys(result)[0]).toBe("undo");
    expect(members(result[1])).toEqual(["x", "y"]);
  });
});
