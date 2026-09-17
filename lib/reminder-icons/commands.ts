// Side-effecting reminder-icon operations: assignment on sync, and the
// editor's patch/reorder/delete/prune actions. All state changes route
// through store.ts's mutateEntries.

import {
  FALLBACK_REMINDER_GLYPH,
  matchReminderIconByKeyword,
  normalizeGlyph,
  normalizeReminderKey,
} from "../reminder-glyph";
import type { Task } from "../types";
import { scheduleClassification } from "./classify";
import { mutateEntries, sortEntries } from "./store";
import type { ReminderIconEntry, ReminderIconPatch } from "./types";

/**
 * A reminder auto-joins the bar if it repeats — a standing chore is exactly
 * what a permanent tile is for. One-offs still get a sigil (so the panel and
 * any future surface can show one) but stay out of the bar until pinned.
 */
export function taskRepeats(task: Pick<Task, "repeat" | "recurs">) {
  return Boolean(task.repeat) || task.recurs === true;
}

/**
 * Ensure every supplied reminder has an icon assignment. Safe to call on every
 * task write and every iCloud sync: existing keys are only touched to refresh
 * `displayName`/`lastSeenAt`, and nothing here can throw into the caller.
 */
export async function ensureReminderIcons(
  tasks: Pick<Task, "name" | "repeat" | "recurs">[],
): Promise<void> {
  const seen = new Map<string, { displayName: string; repeats: boolean }>();

  for (const task of tasks) {
    const name = typeof task.name === "string" ? task.name.trim() : "";
    if (!name) {
      continue;
    }
    const key = normalizeReminderKey(name);
    if (!key) {
      continue;
    }

    const previous = seen.get(key);
    seen.set(key, {
      displayName: previous?.displayName ?? name,
      repeats: (previous?.repeats ?? false) || taskRepeats(task),
    });
  }

  if (seen.size === 0) {
    return;
  }

  const created: { key: string; displayName: string }[] = [];

  try {
    await mutateEntries((entries) => {
      const byKey = new Map(entries.map((entry) => [entry.key, entry]));
      let maxOrder = entries.reduce((max, entry) => Math.max(max, entry.order), -1);
      let changed = false;
      const now = new Date().toISOString();

      for (const [key, info] of seen) {
        const existing = byKey.get(key);

        if (existing) {
          // Only refresh the cheap descriptive fields. The glyph, the source
          // and the user's showInBar decision are all left alone.
          const showInBar =
            existing.showInBarLocked || !info.repeats ? existing.showInBar : true;

          if (
            existing.displayName !== info.displayName ||
            existing.showInBar !== showInBar
          ) {
            byKey.set(key, { ...existing, displayName: info.displayName, showInBar, lastSeenAt: now });
            changed = true;
          }
          continue;
        }

        const keywordId = matchReminderIconByKeyword(info.displayName);
        maxOrder += 1;
        byKey.set(key, {
          key,
          displayName: info.displayName,
          glyph: keywordId ? { kind: "phosphor", id: keywordId } : FALLBACK_REMINDER_GLYPH,
          source: keywordId ? "keyword" : "fallback",
          showInBar: info.repeats,
          showInBarLocked: false,
          order: maxOrder,
          lastSeenAt: now,
        });
        created.push({ key, displayName: info.displayName });
        changed = true;
      }

      return { entries: [...byKey.values()], result: undefined, changed };
    });
  } catch (error) {
    // Icon assignment is decoration. It must never fail a reminder write.
    console.error("[nova-dashboard] Failed to assign reminder icons", { error });
    return;
  }

  for (const entry of created) {
    scheduleClassification(entry.key, entry.displayName);
  }
}

export async function patchReminderIcon(key: string, patch: ReminderIconPatch) {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error("Reminder key is required");
  }

  return mutateEntries((entries) => {
    const index = entries.findIndex((entry) => entry.key === trimmedKey);
    const displayName = typeof patch.displayName === "string" ? patch.displayName.trim() : "";
    if (index < 0 && !(displayName && patch.glyph !== undefined)) {
      throw new Error("Reminder not found");
    }

    const current: ReminderIconEntry =
      index >= 0
        ? entries[index]
        : {
            key: trimmedKey,
            displayName,
            glyph: FALLBACK_REMINDER_GLYPH,
            source: "fallback",
            showInBar: false,
            showInBarLocked: false,
            order: entries.reduce((max, entry) => Math.max(max, entry.order), -1) + 1,
            lastSeenAt: new Date().toISOString(),
          };
    const next: ReminderIconEntry = { ...current };

    if (patch.glyph !== undefined) {
      const glyph = normalizeGlyph(patch.glyph);
      if (!glyph) {
        throw new Error("Unknown reminder icon");
      }
      next.glyph = glyph;
      // An explicit choice outranks anything the classifier decides later.
      next.source = "user";
    }

    if (patch.showInBar !== undefined) {
      if (typeof patch.showInBar !== "boolean") {
        throw new Error("showInBar must be a boolean");
      }
      next.showInBar = patch.showInBar;
      next.showInBarLocked = true;
    }

    if (patch.order !== undefined) {
      if (typeof patch.order !== "number" || !Number.isFinite(patch.order)) {
        throw new Error("order must be a number");
      }
      next.order = patch.order;
    }

    return {
      entries: index >= 0 ? entries.map((entry) => (entry.key === trimmedKey ? next : entry)) : [...entries, next],
      result: next,
    };
  });
}

/** Persist an explicit ordering, as emitted by the config list's reorder controls. */
export async function reorderReminderIcons(keys: string[]) {
  const position = new Map(keys.map((key, index) => [key, index]));

  return mutateEntries((entries) => {
    const next = entries.map((entry) => {
      const order = position.get(entry.key);
      return order === undefined ? entry : { ...entry, order };
    });

    return { entries: next, result: sortEntries(next) };
  });
}

/** Forget one reminder's assignment entirely. */
export async function deleteReminderIcon(key: string) {
  const trimmedKey = key.trim();

  return mutateEntries((entries) => {
    const kept = entries.filter((entry) => entry.key !== trimmedKey);
    return {
      entries: kept,
      result: kept,
      changed: kept.length !== entries.length,
    };
  });
}

/** Drop assignments for reminders that no longer exist anywhere. */
export async function pruneReminderIcons(liveKeys: Set<string>) {
  return mutateEntries((entries) => {
    const kept = entries.filter((entry) => liveKeys.has(entry.key));
    return {
      entries: kept,
      result: kept,
      changed: kept.length !== entries.length,
    };
  });
}
