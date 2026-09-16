"use client";

import { normalizeGlyph } from "../../../../lib/reminder-glyph";
import type { RosterEntry, TileOrder } from "./types";

export const TICK_MS = 1000;

/**
 * Soonest first, so the tile you are most likely to want is nearest the clock,
 * and everything already dealt with (`nextDueMs` of Infinity) collects at the
 * far end. The roster's manual order survives only as the tiebreak between
 * reminders due at the same moment.
 */
export function compareReminderTiles(left: TileOrder, right: TileOrder) {
  return left.nextDueMs - right.nextDueMs || left.order - right.order || left.key.localeCompare(right.key);
}

export function parseRoster(raw: string): RosterEntry[] {
  const payload = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(payload.entries)) {
    return [];
  }

  return payload.entries.flatMap((value) => {
    if (!value || typeof value !== "object") {
      return [];
    }
    const entry = value as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key : "";
    const glyph = normalizeGlyph(entry.glyph);
    if (!key || !glyph) {
      return [];
    }

    return [
      {
        key,
        displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : key,
        glyph,
        showInBar: entry.showInBar !== false,
        order: typeof entry.order === "number" ? entry.order : 0,
      },
    ];
  });
}
