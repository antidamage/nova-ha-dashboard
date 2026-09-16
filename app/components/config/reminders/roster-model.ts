import { FALLBACK_REMINDER_GLYPH, normalizeGlyph } from "../../../../lib/reminder-glyph";
import type { ReminderOutlineShape } from "../../dashboard/reminderBarSettings";
import type { RosterEntry } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseRoster(value: unknown): RosterEntry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return [];
  }

  return value.entries.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.key !== "string") {
      return [];
    }
    const glyph = normalizeGlyph(raw.glyph) ?? FALLBACK_REMINDER_GLYPH;
    const source = raw.source;

    return [
      {
        key: raw.key,
        displayName: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : raw.key,
        glyph,
        source:
          source === "user" || source === "llm" || source === "keyword" || source === "fallback"
            ? source
            : "fallback",
        showInBar: raw.showInBar !== false,
        order: typeof raw.order === "number" ? raw.order : 0,
      },
    ];
  });
}

export function configWithOutlineShape(config: unknown, outlineShape: ReminderOutlineShape) {
  const base = isRecord(config) ? config : {};
  const dashboard = isRecord(base.dashboard) ? base.dashboard : {};
  const reminders = isRecord(dashboard.reminders) ? dashboard.reminders : {};

  return {
    ...base,
    dashboard: { ...dashboard, reminders: { ...reminders, outlineShape } },
  };
}
