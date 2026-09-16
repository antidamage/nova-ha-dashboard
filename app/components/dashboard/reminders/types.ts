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
};

export type TileOrder = Pick<Tile, "key" | "nextDueMs" | "order">;
