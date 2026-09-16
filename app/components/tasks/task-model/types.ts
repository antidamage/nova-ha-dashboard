import type { TaskFollows, TaskRepeat } from "../../../../lib/types";

export type TaskTab = "today" | "upcoming";
/**
 * The editor's schedule modes. `after` is not a `TaskRepeat` — it produces a
 * `follows` link instead — but it belongs in the same picker because it answers
 * the same question: when does this come back?
 */
export type TaskRepeatDraftKind = TaskRepeat["kind"] | "after";

export type TaskDraft = {
  name: string;
  start: string;
  end: string;
  hasEnd: boolean;
  repeatEnabled: boolean;
  repeatKind: TaskRepeatDraftKind;
  repeatDays: string;
  followTaskId: string;
  followOffsetDays: string;
  followHour: string;
  annoy: boolean;
  /** Per-module state carried through the editor, keyed by module id. */
  moduleData?: Record<string, unknown>;
};

export type AlertState = {
  taskId: string;
  name: string;
  end?: string;
};

export type TaskEditorSaveDraft = {
  name: string;
  start: string;
  end?: string | null;
  repeat: TaskRepeat | null;
  follows: TaskFollows | null;
  annoy: boolean;
  moduleData?: Record<string, unknown>;
};
