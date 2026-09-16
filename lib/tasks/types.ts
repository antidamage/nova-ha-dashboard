// Shapes the task store reads and writes. Types only: the file layout, the two
// input shapes the API accepts, and the undo journal's record.
import type { Task, TaskSource } from "../types";

export type TaskFile = {
  tasks?: unknown;
};

export type TaskInput = {
  name: unknown;
  start: unknown;
  end?: unknown;
  repeat?: unknown;
  source?: TaskSource;
  sourceId?: string;
  sourceCalendar?: string;
  occurrenceDate?: string;
  readOnly?: boolean;
  annoy?: unknown;
  follows?: unknown;
  moduleData?: unknown;
};

export type TaskPatch = Partial<{
  name: unknown;
  start: unknown;
  end: unknown;
  repeat: unknown;
  annoy: unknown;
  follows: unknown;
  moduleData: unknown;
}>;

// Completions that can still be taken back.
//
// A snapshot is required rather than "just clear dismissedAt": completing a
// repeating task also rolls it forward to the next occurrence, so by the time
// the user wants their mis-tap back, the task they tapped no longer exists in
// that shape. The journal is in-process and deliberately unpersisted — an undo
// window is a few minutes of grace for a fat finger on a wall panel, not
// durable state worth surviving a restart.
export type TaskUndoRecord = {
  task: Task;
  /**
   * Pre-completion state of the reminders that follow this one. Completing an
   * anchor reschedules them, so taking the completion back has to put them
   * where they were as well.
   */
  followers: Task[];
  completedAt: number;
};
