import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import path from "path";
import {
  applyPatch,
  clone,
  deepEqual,
  diffJson,
  getAtPointer,
  hasPointer,
  removeAtPointer,
  setAtPointer,
  type JsonPatch,
} from "./json-patch";

/**
 * Revision history for the whole dashboard preference document.
 *
 * A running diff: every revision stores only the JSON Patch that carries the
 * previous revision's state to its own. Any point in time is reconstructed by
 * replaying from the nearest checkpoint, which is what lets the restore UI hand
 * back a subtree that did not change at that moment — the question "what did
 * lighting look like on Tuesday" has an answer whether or not lighting was
 * touched on Tuesday.
 *
 * ## Revisions are minute buckets
 *
 * Ten saves inside one minute are ONE revert point, not ten. Dragging a colour
 * spectrum emits a save per commit, and a history that recorded each of them
 * would bury the change the user actually remembers making under dozens of
 * indistinguishable neighbours. So a revision is keyed by its UTC minute: the
 * first write in a minute opens it, and every later write in that same minute
 * re-computes its patch against the state as it stood when the minute opened.
 * The revision therefore always means "everything that happened during this
 * minute", and winding back to it lands on a boundary a person can recognise.
 */

/**
 * Read per call rather than captured at import, so the directory is a runtime
 * fact. Tests point it at a temp dir without having to reset the module graph.
 */
const historyDir = () => process.env.NOVA_DASHBOARD_HISTORY
  ?? path.join(process.cwd(), "data", "history", "preferences");

const LOG_PATH = () => path.join(historyDir(), "log.jsonl");
/** Full state as at the start of the currently open minute bucket. */
const OPEN_BASE_PATH = () => path.join(historyDir(), "open-base.json");
const GENESIS_PATH = () => path.join(historyDir(), "genesis.json");

/** Replay cost is bounded by writing a full snapshot this often. */
const CHECKPOINT_EVERY = 50;
/** Revisions kept before the oldest are compacted away. Roughly a year of use. */
export const HISTORY_MAX_REVISIONS = 2_000;

export type PreferencesRevision = {
  /** The UTC minute this revision covers, e.g. `2026-08-06T21:34`. */
  id: string;
  /** First write folded into this revision. */
  at: string;
  /** Last write folded into it. Equal to `at` for a single-change minute. */
  lastAt: string;
  /** How many individual saves this revert point represents. */
  changes: number;
  /** Where the change landed, as JSON pointers, deduplicated to a useful depth. */
  paths: string[];
  /** Short human sentence for the timeline. */
  summary: string;
  /** Carries the previous revision's state to this one's. */
  patch: JsonPatch;
};

export type PreferencesRevisionSummary = Omit<PreferencesRevision, "patch"> & {
  /** Patch size, so the UI can show weight without shipping the patch. */
  operations: number;
};

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

function checkpointPath(index: number) {
  return path.join(historyDir(), `checkpoint-${String(index).padStart(6, "0")}.json`);
}

/** `2026-08-06T21:34` — the bucket every write in that minute shares. */
export function minuteBucket(at: Date | string) {
  const date = typeof at === "string" ? new Date(at) : at;
  return date.toISOString().slice(0, 16);
}

/**
 * Timestamp churn is not history.
 *
 * Saving any section stamps its `updatedAt`, so a write that changed nothing
 * else still produces a diff. Recording those would fill the timeline with
 * revert points that restore nothing.
 */
function isTimestampOnly(patch: JsonPatch) {
  return patch.length > 0 && patch.every((op) => /\/updatedAt$/.test(op.path));
}

/** Pointers trimmed to the branch a person recognises, e.g. `/phonoscope/colorThemes`. */
function meaningfulPaths(patch: JsonPatch): string[] {
  const seen = new Set<string>();
  for (const op of patch) {
    if (/\/updatedAt$/.test(op.path)) continue;
    const tokens = op.path.split("/").filter(Boolean);
    // Two levels names the feature and the collection inside it; deeper is an
    // index or a field, which the diff view shows anyway.
    seen.add(`/${tokens.slice(0, 2).join("/")}`);
  }
  return [...seen].sort();
}

const SECTION_LABELS: Record<string, string> = {
  phonoscope: "Visualiser",
  theme: "Appearance",
  themeLibrary: "Theme library",
  lighting: "Lighting",
  aircon: "Climate",
  panelHeater: "Panel heater",
  voice: "Voice",
  agent: "Agent",
  watchface: "Watch face",
  update: "Updates",
  layout: "Layout",
  cameras: "Cameras",
};

function describe(patch: JsonPatch, paths: string[]) {
  const sections = [...new Set(paths.map((pointer) => pointer.split("/")[1] ?? ""))]
    .filter(Boolean)
    .map((key) => SECTION_LABELS[key] ?? key);
  // Timestamp ops ride along with every save. Counting them made a one-field
  // edit read as "2 changed", which is the kind of small lie that stops people
  // trusting a history.
  const real = patch.filter((op) => !/\/updatedAt$/.test(op.path));
  const removals = real.filter((op) => op.op === "remove").length;
  const additions = real.filter((op) => op.op === "add").length;
  const edits = real.filter((op) => op.op === "replace").length;
  const parts: string[] = [];
  if (additions) parts.push(`${additions} added`);
  if (removals) parts.push(`${removals} removed`);
  if (edits) parts.push(`${edits} changed`);
  const where = sections.length ? sections.join(", ") : "Preferences";
  return `${where} — ${parts.join(", ") || "no change"}`;
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

/**
 * A selectable tree of the document at a revision.
 *
 * Every branch is offered, not only the ones this revision touched, because
 * the user asked for "restore this part as it was then" rather than "undo what
 * changed then". `changed` marks the branches this particular revision moved,
 * so the UI can lead with them without hiding the rest.
 */
export type HistoryTreeNode = {
  pointer: string;
  label: string;
  kind: "object" | "array" | "value";
  /** Children for containers; absent for leaves. */
  children?: HistoryTreeNode[];
  /** Number of entries, for arrays and objects. */
  size?: number;
  /** This revision's patch touched at or below here. */
  changed: boolean;
  /** Present now, absent at the revision, or the reverse. */
  status: "same" | "added-since" | "missing-now";
};

function isContainer(value: unknown) {
  return typeof value === "object" && value !== null;
}

export function buildHistoryTree(
  atRevision: unknown,
  current: unknown,
  patch: JsonPatch,
  depth = 2,
): HistoryTreeNode[] {
  const touched = new Set(patch.map((op) => op.path));
  const changedAtOrBelow = (pointer: string) =>
    [...touched].some((path_) => path_ === pointer || path_.startsWith(`${pointer}/`));

  const build = (pointer: string, value: unknown, label: string, level: number): HistoryTreeNode => {
    const existsNow = hasPointer(current, pointer);
    const existedThen = hasPointer(atRevision, pointer);
    const node: HistoryTreeNode = {
      pointer,
      label,
      kind: Array.isArray(value) ? "array" : isContainer(value) ? "object" : "value",
      changed: changedAtOrBelow(pointer),
      status: existedThen && !existsNow ? "missing-now"
        : !existedThen && existsNow ? "added-since"
        : "same",
    };
    if (Array.isArray(value)) {
      node.size = value.length;
    } else if (isContainer(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      node.size = entries.length;
      if (level < depth) {
        node.children = entries.map(([key, child]) =>
          build(`${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, child, key, level + 1));
      }
    }
    return node;
  };

  const roots = new Set([
    ...Object.keys((atRevision ?? {}) as Record<string, unknown>),
    ...Object.keys((current ?? {}) as Record<string, unknown>),
  ]);
  return [...roots].sort().map((key) => {
    const pointer = `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    const value = hasPointer(atRevision, pointer)
      ? getAtPointer(atRevision, pointer)
      : getAtPointer(current, pointer);
    return build(pointer, value, SECTION_LABELS[key] ?? key, 0);
  });
}

/**
 * Splices the chosen subtrees, as they stood at a revision, into `current`.
 *
 * A pointer that did not exist at that revision is *removed* from the result
 * rather than skipped: "restore this branch to how it was" has to be able to
 * mean "it wasn't there". Nothing is written here — the caller passes the
 * result through the normal preferences write path so validation, merging and
 * the usual change events all still happen, and the restore is itself recorded
 * as a new revision so it can be wound back in turn.
 */
export function restoreSubtrees(
  current: unknown,
  atRevision: unknown,
  pointers: string[],
): unknown {
  let next = clone(current);
  // Shallow pointers first, so restoring `/phonoscope` then `/phonoscope/theme`
  // ends with the more specific choice winning rather than being overwritten.
  const ordered = [...new Set(pointers)].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const pointer of ordered) {
    if (!pointer || pointer === "/") {
      next = clone(atRevision);
      continue;
    }
    if (hasPointer(atRevision, pointer)) {
      next = setAtPointer(next, pointer, getAtPointer(atRevision, pointer));
    } else {
      next = removeAtPointer(next, pointer);
    }
  }
  return next;
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

export const __historyInternals = { isTimestampOnly, meaningfulPaths, describe, historyDir };
