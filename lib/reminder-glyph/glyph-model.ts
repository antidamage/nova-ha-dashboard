import { REMINDER_ICON_CATALOG, isReminderIconId } from "./catalogue";
import { REMINDER_GLYPH_TEXT_MAX_LENGTH } from "./constants";
import type { ReminderGlyph } from "./types";

/**
 * Stable identity for a reminder across iCloud resyncs.
 *
 * Mirrored tasks are regenerated with fresh ids every sync (icloud-sync.ts
 * `taskIdFor`), so an icon assignment keyed on task id would be lost roughly
 * every ten minutes. The name is the only thing that survives, and this
 * normaliser mirrors the one behind `localTaskMatchesReminder` so the two
 * systems agree on when two reminders are "the same reminder".
 */
export function normalizeReminderKey(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeGlyph(value: unknown): ReminderGlyph | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ReminderGlyph> & Record<string, unknown>;

  if (candidate.kind === "text") {
    const text = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!text) {
      return null;
    }
    return { kind: "text", value: [...text].slice(0, REMINDER_GLYPH_TEXT_MAX_LENGTH).join("") };
  }

  if (candidate.kind === "phosphor" && isReminderIconId(candidate.id)) {
    return { kind: "phosphor", id: candidate.id };
  }

  return null;
}

export function glyphsEqual(left: ReminderGlyph, right: ReminderGlyph) {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "text" && right.kind === "text") {
    return left.value === right.value;
  }
  if (left.kind === "phosphor" && right.kind === "phosphor") {
    return left.id === right.id;
  }
  return false;
}

/**
 * Deterministic first pass at "what is this reminder about". Runs before the
 * LLM so the common household chores resolve instantly and offline, and so a
 * voice-host outage still produces something better than a generic bell.
 *
 * Returns the id of the longest matching keyword — longer keywords are more
 * specific, which is what makes "wash hair" (shower) win over "washing"
 * (washing machine).
 */
export function matchReminderIconByKeyword(name: string): string | null {
  // Both sides are normalised to space-delimited words and the haystack is
  // padded, so ` needle ` is a whole-word/phrase test. That keeps "car" from
  // matching "carrot" without needing a regex per keyword.
  const haystack = ` ${normalizeReminderKey(name)} `;
  let bestId: string | null = null;
  let bestLength = 0;

  for (const entry of REMINDER_ICON_CATALOG) {
    for (const keyword of entry.keywords) {
      const needle = normalizeReminderKey(keyword);
      if (!needle || needle.length <= bestLength) {
        continue;
      }
      if (haystack.includes(` ${needle} `)) {
        bestId = entry.id;
        bestLength = needle.length;
      }
    }
  }

  return bestId;
}
