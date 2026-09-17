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
 *
 * Facade. The body lives in lib/preferences-history/; this file keeps the
 * import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   preferences-history/types.ts          revision, summary and tree shapes
 *   preferences-history/constants.ts      history paths, checkpoint and cap sizes,
 *                                         section labels
 *   preferences-history/summary-model.ts  minute buckets, paths, summary line
 *   preferences-history/tree-model.ts     restore tree and subtree splice
 *   preferences-history/store.ts          SOLE disk owner: log, open base,
 *                                         checkpoints, genesis, record/replay
 */
export { HISTORY_MAX_REVISIONS } from "./preferences-history/constants";
export type {
  HistoryTreeNode,
  PreferencesRevision,
  PreferencesRevisionSummary,
} from "./preferences-history/types";
export { __historyInternals, minuteBucket } from "./preferences-history/summary-model";
export { buildHistoryTree, restoreSubtrees } from "./preferences-history/tree-model";
export {
  ensureGenesis,
  listPreferencesRevisions,
  preferencesAtRevision,
  recordPreferencesRevision,
} from "./preferences-history/store";
