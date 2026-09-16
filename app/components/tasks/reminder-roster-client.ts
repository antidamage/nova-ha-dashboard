import {
  FALLBACK_REMINDER_GLYPH,
  normalizeGlyph,
  normalizeReminderKey,
  type ReminderGlyph,
} from "../../../lib/reminder-glyph";

/**
 * Client side of the reminder roster (`/api/reminders/icons`) as the Reminders
 * editor uses it: the glyph is the roster's, keyed by normalised reminder name,
 * exactly as RemindersConfig and the reminder bar read it. specs/tasks-panel.md
 * "Icon".
 */

/** Fired on window after this screen writes the roster, so the bar reloads without waiting on SSE. */
export const REMINDER_ICONS_CHANGED_EVENT = "nova:reminder-icons-changed";

export type RosterGlyphs = Map<string, ReminderGlyph>;

export function parseRosterGlyphs(value: unknown): RosterGlyphs {
  const glyphs: RosterGlyphs = new Map();
  const entries = value && typeof value === "object" ? (value as { entries?: unknown }).entries : null;
  if (!Array.isArray(entries)) return glyphs;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const { key, glyph } = raw as { key?: unknown; glyph?: unknown };
    const normalized = normalizeGlyph(glyph);
    if (typeof key === "string" && normalized) glyphs.set(key, normalized);
  }
  return glyphs;
}

export async function loadRosterGlyphs(): Promise<RosterGlyphs> {
  const response = await fetch("/api/reminders/icons", { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load reminder icons");
  return parseRosterGlyphs(await response.json());
}

export function rosterGlyphFor(glyphs: RosterGlyphs, name: string): ReminderGlyph {
  return glyphs.get(normalizeReminderKey(name)) ?? FALLBACK_REMINDER_GLYPH;
}

export type GlyphWrite = { key: string; displayName: string; glyph: ReminderGlyph };

/**
 * What a save writes to the roster, or null. A glyph the user chose is written
 * under the saved name; otherwise a rename carries the old key's glyph across.
 */
export function glyphWriteForSave({
  chosen,
  glyphs,
  name,
  previousName,
}: {
  chosen: ReminderGlyph | null;
  glyphs: RosterGlyphs;
  name: string;
  previousName?: string;
}): GlyphWrite | null {
  const displayName = name.trim();
  const key = normalizeReminderKey(displayName);
  if (!key) return null;
  if (chosen) return { key, displayName, glyph: chosen };
  if (previousName === undefined) return null;
  const previousKey = normalizeReminderKey(previousName);
  const carried = previousKey && previousKey !== key ? glyphs.get(previousKey) : undefined;
  return carried ? { key, displayName, glyph: carried } : null;
}

export async function writeReminderGlyph(write: GlyphWrite) {
  const response = await fetch("/api/reminders/icons", {
    body: JSON.stringify({ key: write.key, glyph: write.glyph, displayName: write.displayName }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Reminder icon update failed");
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REMINDER_ICONS_CHANGED_EVENT));
}
