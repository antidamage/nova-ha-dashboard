import { describe, expect, it } from "vitest";

import { mergeUpcomingTiles } from "./tile-model";
import type { Tile } from "./types";

const syringe = { kind: "phosphor", id: "syringe" } as const;

function tile(key: string, state: Tile["state"], nextDueMs: number, glyph: Tile["glyph"] = syringe): Tile {
  return { key, displayName: key, glyph, state, taskId: state === "idle" ? null : key, undoUntil: null, nextDueMs, order: 0 };
}

describe("mergeUpcomingTiles", () => {
  it("merges upcoming reminders that share an icon and lists both", () => {
    const merged = mergeUpcomingTiles([tile("trulicity", "idle", 2_000), tile("estrogen", "idle", 1_000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].members?.map((member) => member.name)).toEqual(["estrogen", "trulicity"]);
    expect(merged[0].nextDueMs).toBe(1_000);
  });

  it("keeps a due reminder separate from an upcoming one", () => {
    const merged = mergeUpcomingTiles([tile("trulicity", "due", 0), tile("estrogen", "idle", 5_000)]);
    expect(merged).toHaveLength(2);
  });

  it("does not merge different icons", () => {
    const other = { kind: "phosphor", id: "pill" } as const;
    expect(mergeUpcomingTiles([tile("a", "idle", 1), tile("b", "idle", 2, other)])).toHaveLength(2);
  });
});
