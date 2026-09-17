// Reminder icon assignment — facade. The body lives in lib/reminder-icons/;
// this file keeps the import path stable for its callers
// (specs/agent-token-footprint.md §3.3).
//
// Keyed on the NORMALISED REMINDER NAME, not the task id. iCloud mirrors are
// regenerated with fresh ids on every sync (icloud-sync.ts `taskIdFor` hashes
// source|sourceId|occurrenceDate, and the whole mirror is rebuilt every ~10
// minutes), so an id-keyed assignment would evaporate constantly. The name is
// the only durable handle, and it is also what lets a user assign an icon to a
// read-only Apple reminder at all — `updateTask` refuses to touch mirrored
// tasks, so the assignment cannot live on the Task.
//
// Assignment order when a reminder is first seen:
//   1. existing entry            (a user's choice is permanently sticky)
//   2. keyword match             (instant, offline, covers the usual chores)
//   3. LLM via the voice host    (best-effort, async, never blocks)
//   4. generic bell
//
// The LLM step deliberately does NOT block reminder creation. Adding a
// reminder must not fail, or hang, because voiceHost is busy or down.
//
// Where things are:
//
//   reminder-icons/types.ts      ReminderIconEntry, ReminderIconPatch, file shape
//   reminder-icons/store.ts      SOLE state owner: the JSON file, write queue,
//                                read/write/mutate primitives
//   reminder-icons/classify.ts   fire-and-forget LLM refinement
//   reminder-icons/commands.ts   ensureReminderIcons, patch/reorder/delete/prune

export type { ReminderIconAssignmentSource, ReminderIconEntry, ReminderIconPatch } from "./reminder-icons/types";

export { readReminderIcons } from "./reminder-icons/store";

export {
  taskRepeats,
  ensureReminderIcons,
  patchReminderIcon,
  reorderReminderIcons,
  deleteReminderIcon,
  pruneReminderIcons,
} from "./reminder-icons/commands";
