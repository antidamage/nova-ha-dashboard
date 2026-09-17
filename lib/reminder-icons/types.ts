import type { ReminderGlyph } from "../reminder-glyph";

export type ReminderIconAssignmentSource = "user" | "llm" | "keyword" | "fallback";

export type ReminderIconEntry = {
  /** Normalised reminder name — the join key against live tasks. */
  key: string;
  /** Last-seen human spelling, for the config list. */
  displayName: string;
  glyph: ReminderGlyph;
  source: ReminderIconAssignmentSource;
  showInBar: boolean;
  /**
   * True once the user has toggled `showInBar` themselves. After that the
   * "repeating reminders auto-join" rule stops second-guessing them.
   */
  showInBarLocked: boolean;
  order: number;
  lastSeenAt: string;
};

export type IconFile = {
  entries?: unknown;
};

export type ReminderIconPatch = {
  glyph?: unknown;
  showInBar?: unknown;
  order?: unknown;
  /**
   * With a glyph, creates the entry when the key is not in the roster yet: the
   * Reminders editor writes a new reminder's glyph straight after creating it,
   * before the fire-and-forget assignment has necessarily run, and a rename
   * carries a glyph to a key nothing has observed yet.
   */
  displayName?: unknown;
};
