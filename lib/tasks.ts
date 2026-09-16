/**
 * Dashboard reminders (tasks) — facade. The body lives in lib/tasks/; this file
 * keeps the import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   tasks/types.ts            file, input, patch and undo-record shapes
 *   tasks/constants.ts        repeat and follow-on bounds
 *   tasks/schedule-model.ts   next-occurrence maths, ordering, window checks
 *   tasks/normalize-model.ts  validation and normalisation, module data merge
 *   tasks/store.ts            SOLE owner of state and disk: data path, write
 *                             queue, chime claims, undo journal; readTasks,
 *                             writeTasks, dismissTaskAlert, completeTask
 *   tasks/commands.ts         add, update, delete, wash reminder, module data
 *   tasks/completion.ts       chime marking, undoing a completion
 *
 * parseTaskCsv lives in lib/parse-task-csv.ts and is re-exported here as before.
 */
export { parseTaskCsv } from "./parse-task-csv";
export type { ParseTaskCsvError, ParseTaskCsvResult } from "./parse-task-csv";
export {
  claimWashChime,
  completedTaskUndoDeadline,
  completeTask,
  dismissTaskAlert,
  readTasks,
  writeTasks,
} from "./tasks/store";
export { addTask, addTasks, deleteTasks, setTaskModuleData, syncWashReminder, updateTask } from "./tasks/commands";
export { markTaskAlertChimed, uncompleteTask } from "./tasks/completion";
