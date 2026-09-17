import type { ReminderGlyph, ReminderIconGroup } from "./types";

export const FALLBACK_REMINDER_ICON_ID = "bell";

export const REMINDER_GLYPH_TEXT_MAX_LENGTH = 2;

export const REMINDER_ICON_GROUP_LABELS: Record<ReminderIconGroup, string> = {
  health: "Health",
  hygiene: "Hygiene",
  home: "Home",
  money: "Money",
  life: "Life",
};

export const FALLBACK_REMINDER_GLYPH: ReminderGlyph = {
  kind: "phosphor",
  id: FALLBACK_REMINDER_ICON_ID,
};
