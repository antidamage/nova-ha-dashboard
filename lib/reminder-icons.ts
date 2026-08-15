// Which sigil belongs to which reminder, and which reminders earn a tile in
// the icon bar.
//
// Keyed on the NORMALISED REMINDER NAME, not the task id. iCloud mirrors are
// regenerated with fresh ids on every sync (icloud-sync.ts `taskIdFor` hashes
// source|sourceId|occurrenceDate, and the whole mirror is rebuilt every ~10
// minutes), so an id-keyed assignment would evaporate constantly. The name is
// the only durable handle, and it is also what lets a user assign an icon to a
// read-only Apple reminder at all — `updateTask` refuses to touch mirrored
// tasks, so the assignment cannot live on the Task.
//
// Assignment order when a reminder is first seen:
//   1. existing entry            (a user's choice is permanently sticky)
//   2. keyword match             (instant, offline, covers the usual chores)
//   3. LLM via the voice host    (best-effort, async, never blocks)
//   4. generic bell
//
// The LLM step deliberately does NOT block reminder creation. Adding a
// reminder must not fail, or hang, because voiceHost is busy or down.

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { readDashboardConfig } from "./dashboard-config";
import { publishReminderIcons } from "./dashboard-events";
import { classifyReminderIcon } from "./voice-host-settings";
import {
  FALLBACK_REMINDER_GLYPH,
  glyphsEqual,
  matchReminderIconByKeyword,
  normalizeGlyph,
  normalizeReminderKey,
  type ReminderGlyph,
} from "./reminder-glyph";
import type { Task } from "./types";

const ICONS_PATH =
  process.env.NOVA_DASHBOARD_REMINDER_ICONS ??
  path.join(process.cwd(), "data", "reminder-icons.json");

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

type IconFile = {
  entries?: unknown;
};

let writeQueue = Promise.resolve();

/**
 * Keys with an LLM classification already in flight. Reminder sync re-runs
 * every ten minutes over the same names; without this, a voice host that is
 * merely slow would collect a new request per name per sync.
 */
const pendingClassifications = new Set<string>();

function normalizedEntry(value: unknown): ReminderIconEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  const glyph = normalizeGlyph(raw.glyph);
  if (!key || !glyph) {
    return null;
  }

  const source = raw.source;

  return {
    key,
    displayName:
      typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : key,
    glyph,
    source:
      source === "user" || source === "llm" || source === "keyword" || source === "fallback"
        ? source
        : "fallback",
    showInBar: raw.showInBar !== false,
    showInBarLocked: raw.showInBarLocked === true,
    order: Number.isFinite(raw.order) ? Number(raw.order) : 0,
    lastSeenAt:
      typeof raw.lastSeenAt === "string" && raw.lastSeenAt ? raw.lastSeenAt : new Date().toISOString(),
  };
}

function sortEntries(entries: ReminderIconEntry[]) {
  return [...entries].sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

async function readIconFile(): Promise<ReminderIconEntry[]> {
  try {
    const raw = await readFile(ICONS_PATH, "utf8");
    const parsed = JSON.parse(raw) as IconFile;
    if (!Array.isArray(parsed.entries)) {
      return [];
    }
    return sortEntries(parsed.entries.map(normalizedEntry).filter((entry): entry is ReminderIconEntry => Boolean(entry)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      return [];
    }
    // A corrupt icon file must not take the reminders panel down with it.
    console.error("[nova-dashboard] Failed to read reminder icons", { error });
    return [];
  }
}

async function writeIconFile(entries: ReminderIconEntry[]): Promise<void> {
  await mkdir(path.dirname(ICONS_PATH), { recursive: true });
  const tempPath = `${ICONS_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ entries: sortEntries(entries) }, null, 2)}\n`, "utf8");
  await rename(tempPath, ICONS_PATH);
}

async function mutateEntries<T>(
  mutator: (entries: ReminderIconEntry[]) => { entries: ReminderIconEntry[]; result: T; changed?: boolean },
): Promise<T> {
  let nextEntries: ReminderIconEntry[] = [];
  let result: T;
  let changed = true;

  const run = writeQueue.then(async () => {
    const current = await readIconFile();
    const mutation = mutator(current);
    nextEntries = sortEntries(mutation.entries);
    result = mutation.result;
    changed = mutation.changed !== false;
    if (changed) {
      await writeIconFile(nextEntries);
    }
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  await run;
  if (changed) {
    publishReminderIcons(nextEntries);
  }
  return result!;
}

export async function readReminderIcons(): Promise<ReminderIconEntry[]> {
  const run = writeQueue.then(() => readIconFile());
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * A reminder auto-joins the bar if it repeats — a standing chore is exactly
 * what a permanent tile is for. One-offs still get a sigil (so the panel and
 * any future surface can show one) but stay out of the bar until pinned.
 */
export function taskRepeats(task: Pick<Task, "repeat" | "recurs">) {
  return Boolean(task.repeat) || task.recurs === true;
}

async function classifierSettings() {
  try {
    const config = await readDashboardConfig();
    return config.dashboard.reminders.classifier;
  } catch {
    return { enabled: true, timeoutMs: 4000 };
  }
}

/**
 * Fire-and-forget LLM refinement. Only ever upgrades a "keyword"/"fallback"
 * assignment; a user's own choice is never overwritten, and neither is an
 * answer we already got from the LLM.
 */
function scheduleClassification(key: string, displayName: string) {
  if (pendingClassifications.has(key)) {
    return;
  }
  pendingClassifications.add(key);

  void (async () => {
    try {
      const settings = await classifierSettings();
      if (!settings.enabled) {
        return;
      }

      const iconId = await classifyReminderIcon(displayName, settings.timeoutMs);
      if (!iconId) {
        return;
      }

      await mutateEntries((entries) => {
        const index = entries.findIndex((entry) => entry.key === key);
        if (index < 0) {
          return { entries, result: undefined, changed: false };
        }

        const current = entries[index];
        if (current.source === "user" || current.source === "llm") {
          return { entries, result: undefined, changed: false };
        }

        const glyph: ReminderGlyph = { kind: "phosphor", id: iconId };
        if (glyphsEqual(current.glyph, glyph)) {
          // Same answer the keyword table already gave. Still record that the
          // LLM has spoken so we stop asking about this name every sync.
          return {
            entries: entries.map((entry) =>
              entry.key === key ? { ...entry, source: "llm" as const } : entry,
            ),
            result: undefined,
          };
        }

        return {
          entries: entries.map((entry) =>
            entry.key === key ? { ...entry, glyph, source: "llm" as const } : entry,
          ),
          result: undefined,
        };
      });
    } catch (error) {
      console.error("[nova-dashboard] Reminder icon classification failed", { key, error });
    } finally {
      pendingClassifications.delete(key);
    }
  })();
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

export type ReminderIconPatch = {
  glyph?: unknown;
  showInBar?: unknown;
  order?: unknown;
};

export async function patchReminderIcon(key: string, patch: ReminderIconPatch) {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    throw new Error("Reminder key is required");
  }

  return mutateEntries((entries) => {
    const index = entries.findIndex((entry) => entry.key === trimmedKey);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const current = entries[index];
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
      entries: entries.map((entry) => (entry.key === trimmedKey ? next : entry)),
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
