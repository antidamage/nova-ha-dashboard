/** Shapes for the preference history panel. Type-only; import directly. */

export type RevisionSummary = {
  id: string;
  at: string;
  lastAt: string;
  changes: number;
  paths: string[];
  summary: string;
  operations: number;
};

export type TreeNode = {
  pointer: string;
  label: string;
  kind: "object" | "array" | "value";
  children?: TreeNode[];
  size?: number;
  changed: boolean;
  status: "same" | "added-since" | "missing-now";
};
