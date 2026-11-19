import { describe, expect, it } from "vitest";

import { clusterOverflowTiles, rowCapacity } from "./cluster-model";
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

describe("rowCapacity", () => {
  it("counts whole tiles with gaps between them", () => {
    expect(rowCapacity(300, 50, 10)).toBe(5);
    expect(rowCapacity(0, 50, 10)).toBeNull();
  });
});

describe("clusterOverflowTiles", () => {
  it("leaves a bar that fits alone", () => {
    const tiles = [tile("a"), tile("b"), tile("c")];
    expect(clusterOverflowTiles(tiles, 3)).toBe(tiles);
    expect(clusterOverflowTiles(tiles, null)).toBe(tiles);
  });

  it("takes only the tiles that overflow, plus the one the cluster occupies", () => {
    const result = clusterOverflowTiles([tile("a"), tile("b"), tile("c"), tile("d"), tile("e")], 4);
    expect(keys(result).slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(result).toHaveLength(4);
    expect(result[3].cluster?.map((part) => part.key)).toEqual(["d", "e"]);
  });

  it("holds at most four, in population order", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => tile(key));
    const result = clusterOverflowTiles(many, 3);
    expect(result[result.length - 1].cluster?.map((part) => part.key)).toEqual(["e", "f", "g", "h"]);
  });

  it("never clusters active, due, overdue or undoable tiles", () => {
    const tiles = [
      tile("due", "due"),
      tile("late", "overdue"),
      tile("undo", "idle", { undoUntil: 5 }),
      tile("x"),
      tile("y"),
    ];
    const result = clusterOverflowTiles(tiles, 4);
    expect(keys(result).slice(0, 3)).toEqual(["due", "late", "undo"]);
    expect(result[3].cluster?.map((part) => part.key)).toEqual(["x", "y"]);
  });

  it("does not form with fewer than two upcoming tiles available", () => {
    const tiles = [tile("due", "due"), tile("late", "overdue"), tile("only")];
    expect(clusterOverflowTiles(tiles, 2)).toBe(tiles);
  });
});
