// Sole owner of the history's disk I/O: the revision log, the open-minute base,
// checkpoints and genesis.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import { applyPatch, deepEqual, diffJson, type JsonPatch } from "../json-patch";
import {
  CHECKPOINT_EVERY,
  GENESIS_PATH,
  HISTORY_MAX_REVISIONS,
  LOG_PATH,
  OPEN_BASE_PATH,
  checkpointPath,
  historyDir,
} from "./constants";
import { describe, isTimestampOnly, meaningfulPaths, minuteBucket } from "./summary-model";
import type { PreferencesRevision, PreferencesRevisionSummary } from "./types";

async function ensureDir() {
  await mkdir(historyDir(), { recursive: true });
}

async function readLog(): Promise<PreferencesRevision[]> {
  try {
    const raw = await readFile(LOG_PATH(), "utf8");
    return raw.split("\n").flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed) as PreferencesRevision];
      } catch {
        // A truncated final line is the normal shape of an interrupted write.
        // Losing that one revision is strictly better than losing the log.
        return [];
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeLog(revisions: PreferencesRevision[]) {
  await ensureDir();
  const body = revisions.map((revision) => JSON.stringify(revision)).join("\n");
  const temp = `${LOG_PATH()}.${process.pid}.tmp`;
  await writeFile(temp, body ? `${body}\n` : "", "utf8");
  await rename(temp, LOG_PATH());
}

async function writeJson(file: string, value: unknown) {
  await ensureDir();
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Folds one preference write into the history.
 *
 * Called from inside the preferences write queue, so it is already serialised
 * against other writers. It never throws into the caller: losing a history
 * entry must not be able to fail the save the user actually asked for.
 */
export async function recordPreferencesRevision(
  before: unknown,
  after: unknown,
  now = new Date(),
): Promise<PreferencesRevision | null> {
  try {
    if (deepEqual(before, after)) return null;
    await ensureDir();
    const revisions = await readLog();
    const bucket = minuteBucket(now);
    const open = revisions.length && revisions[revisions.length - 1].id === bucket
      ? revisions[revisions.length - 1]
      : null;

    // Within an open minute the patch is recomputed from where that minute
    // started, so ten saves stay one revert point rather than ten.
    const base = open
      ? (await readJson<unknown>(OPEN_BASE_PATH())) ?? before
      : before;
    const patch = diffJson(base, after);

    if (!patch.length || isTimestampOnly(patch)) {
      // Nothing worth reverting to. If a minute is already open we still keep
      // its base, because a later write in the same minute may yet be real.
      if (!open) await writeJson(OPEN_BASE_PATH(), before);
      return null;
    }

    const paths = meaningfulPaths(patch);
    const revision: PreferencesRevision = {
      id: bucket,
      at: open?.at ?? now.toISOString(),
      lastAt: now.toISOString(),
      changes: (open?.changes ?? 0) + 1,
      paths,
      summary: describe(patch, paths),
      patch,
    };

    const next = open ? [...revisions.slice(0, -1), revision] : [...revisions, revision];
    if (!open) await writeJson(OPEN_BASE_PATH(), before);
    await writeLog(next);
    await maybeCheckpoint(next, after);
    await compact(next);
    return revision;
  } catch (error) {
    console.warn("[nova-dashboard] preference history not recorded", error);
    return null;
  }
}

async function maybeCheckpoint(revisions: PreferencesRevision[], state: unknown) {
  if (revisions.length % CHECKPOINT_EVERY !== 0) return;
  await writeJson(checkpointPath(revisions.length), {
    revisionCount: revisions.length,
    revisionId: revisions[revisions.length - 1]?.id ?? "",
    state,
  });
}

/** The newest checkpoint at or before `count` revisions. */
async function nearestCheckpoint(count: number) {
  try {
    const files = (await readdir(historyDir()))
      .filter((name) => /^checkpoint-\d+\.json$/.test(name))
      .map((name) => ({ name, at: Number(name.slice(11, -5)) }))
      .filter((entry) => entry.at <= count)
      .sort((a, b) => b.at - a.at);
    for (const file of files) {
      const loaded = await readJson<{ revisionCount: number; state: unknown }>(
        path.join(historyDir(), file.name));
      if (loaded) return loaded;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return null;
}

export async function listPreferencesRevisions(): Promise<PreferencesRevisionSummary[]> {
  const revisions = await readLog();
  return revisions
    .map(({ patch, ...rest }) => ({ ...rest, operations: patch.length }))
    .reverse();
}

/**
 * The full preference document as it stood at a revision.
 *
 * `before` gives the state the revision changed *away from* — "wind back to
 * before this change", including a deletion, which is the whole point.
 */
export async function preferencesAtRevision(
  revisionId: string,
  options: { before?: boolean } = {},
): Promise<{ state: unknown; revision: PreferencesRevisionSummary; patch: JsonPatch } | null> {
  const revisions = await readLog();
  const index = revisions.findIndex((revision) => revision.id === revisionId);
  if (index === -1) return null;
  // Replaying up to and including `index` yields the state after that minute;
  // stopping one short yields the state before it opened.
  const upTo = options.before ? index : index + 1;

  const checkpoint = await nearestCheckpoint(upTo);
  let state: unknown;
  let from: number;
  if (checkpoint) {
    state = checkpoint.state;
    from = checkpoint.revisionCount;
  } else {
    // No checkpoint that early: rebuild from the genesis base, which is the
    // state the very first recorded revision changed away from.
    state = (await readJson<unknown>(GENESIS_PATH())) ?? {};
    from = 0;
  }
  for (let at = from; at < upTo; at += 1) {
    state = applyPatch(state, revisions[at].patch);
  }
  const { patch, ...rest } = revisions[index];
  return { state, revision: { ...rest, operations: patch.length }, patch };
}

/** Records the state the first revision changed away from, once, forever. */
export async function ensureGenesis(state: unknown) {
  if (await readJson<unknown>(GENESIS_PATH())) return;
  await writeJson(GENESIS_PATH(), state);
}

/**
 * Trims the oldest revisions once the log outgrows its cap.
 *
 * The oldest survivor needs a checkpoint at or before it or it becomes
 * unreplayable, so compaction writes one and rewrites genesis to match.
 */
async function compact(revisions: PreferencesRevision[]) {
  if (revisions.length <= HISTORY_MAX_REVISIONS) return;
  const drop = revisions.length - HISTORY_MAX_REVISIONS;
  let state = (await readJson<unknown>(GENESIS_PATH())) ?? {};
  for (let at = 0; at < drop; at += 1) state = applyPatch(state, revisions[at].patch);
  await writeJson(GENESIS_PATH(), state);
  await writeLog(revisions.slice(drop));
  // Checkpoints are counted from the head of the log, which has just moved.
  try {
    for (const name of await readdir(historyDir())) {
      if (/^checkpoint-\d+\.json$/.test(name)) await unlink(path.join(historyDir(), name));
    }
  } catch {
    // A checkpoint that will not delete is a performance problem, not a
    // correctness one: replay still works from genesis.
  }
}
