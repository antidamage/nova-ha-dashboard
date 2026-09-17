import type { JsonPatch } from "../json-patch";

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
