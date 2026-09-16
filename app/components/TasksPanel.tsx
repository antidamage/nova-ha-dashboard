"use client";

// Facade: the Reminders panel. The body lives in ./tasks/ (TasksPanel.tsx is
// the component, useTaskAlerts.ts its alert and chime machine).
export { TasksPanel } from "./tasks/TasksPanel";
export { shouldClearTaskAlert, taskVisibleInTab } from "./tasks/task-model";
