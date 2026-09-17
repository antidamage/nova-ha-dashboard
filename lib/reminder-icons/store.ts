// Sole owner of the reminder-icons disk state: the JSON file, the write
// queue, and the read/write/mutate primitives everything else in this
// package builds on (specs/agent-token-footprint.md §4.2).

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

import { publishReminderIcons } from "../dashboard-events";
import { normalizeGlyph } from "../reminder-glyph";
import type { IconFile, ReminderIconEntry } from "./types";

const ICONS_PATH =
  process.env.NOVA_DASHBOARD_REMINDER_ICONS ??
  path.join(process.cwd(), "data", "reminder-icons.json");

let writeQueue = Promise.resolve();

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

export function sortEntries(entries: ReminderIconEntry[]) {
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

export async function mutateEntries<T>(
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
