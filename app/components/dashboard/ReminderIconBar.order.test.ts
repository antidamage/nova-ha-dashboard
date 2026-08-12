import { describe, expect, it } from "vitest";

import { compareReminderTiles } from "./ReminderIconBar";

function tile(key: string, nextDueMs: number, order = 0) {
  return { key, nextDueMs, order };
}

describe("reminder tile ordering", () => {
  it("puts the soonest reminder first regardless of roster position", () => {
    const ordered = [tile("wash-hair", 3_000, 0), tile("estrogen", 1_000, 5)].sort(compareReminderTiles);

    expect(ordered.map((entry) => entry.key)).toEqual(["estrogen", "wash-hair"]);
  });

  it("shuffles reminders with nothing outstanding to the back", () => {
    const ordered = [
      tile("done", Number.POSITIVE_INFINITY, 0),
      tile("later", 9_000, 9),
      tile("soon", 1_000, 8),
    ].sort(compareReminderTiles);

    expect(ordered.map((entry) => entry.key)).toEqual(["soon", "later", "done"]);
  });

  it("falls back to the roster order for reminders due at the same moment", () => {
    const ordered = [tile("b", 1_000, 2), tile("a", 1_000, 1)].sort(compareReminderTiles);

    expect(ordered.map((entry) => entry.key)).toEqual(["a", "b"]);
  });
});
