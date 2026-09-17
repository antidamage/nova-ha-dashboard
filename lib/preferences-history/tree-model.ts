// Pure: the restore tree offered by the history UI, and the subtree splice.
import { clone, getAtPointer, hasPointer, removeAtPointer, setAtPointer, type JsonPatch } from "../json-patch";
import { SECTION_LABELS } from "./constants";
import type { HistoryTreeNode } from "./types";

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
