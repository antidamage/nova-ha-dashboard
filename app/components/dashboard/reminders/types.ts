import type { ReminderGlyph } from "../../../../lib/reminder-glyph";

export type RosterEntry = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  showInBar: boolean;
  order: number;
};

export type TileState = "idle" | "due" | "overdue";

export type Tile = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  state: TileState;
  /** The reminder a tap would complete, if there is one. */
  taskId: string | null;
  /** Set while this tile's completion can still be held-to-undone. */
  undoUntil: number | null;
  /** Start of the soonest outstanding occurrence; Infinity when nothing is due. */
  nextDueMs: number;
  /** The roster's manual position, kept as a stable tiebreak. */
  order: number;
  /** Set on a tile standing for several upcoming reminders that share one icon. */
  members?: { name: string; nextDueMs: number }[];
  /** Set on the overflow cluster: the upcoming tiles drawn quarter-size inside this one, in population order. */
  cluster?: Tile[];
};

export type TileOrder = Pick<Tile, "key" | "nextDueMs" | "order">;
