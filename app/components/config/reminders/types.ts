import type { ReminderGlyph } from "../../../../lib/reminder-glyph";

export type RosterEntry = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  source: "user" | "llm" | "keyword" | "fallback";
  showInBar: boolean;
  order: number;
};
