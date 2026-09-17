"use client";

/*
 * Preference history panel — facade. The body lives in history/
 * (specs/agent-token-footprint.md §3.3). Lazily loaded by ConfigWorkspace, so
 * this re-exports only the component.
 *
 *   history/types.ts          RevisionSummary, TreeNode
 *   history/TreeRow.tsx       one branch of the config at a revision
 *   history/HistoryPanel.tsx  the revision list and restore flow
 */
export { HistoryPanel } from "./history/HistoryPanel";
