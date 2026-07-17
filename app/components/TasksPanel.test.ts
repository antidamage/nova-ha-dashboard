import { describe, expect, it } from "vitest";
import type { Task } from "../../lib/types";
import { shouldClearTaskAlert, taskVisibleInTab } from "./TasksPanel";

const now = new Date(2026, 4, 21, 12, 0, 0).getTime();

function localIso(dayOffset: number, hour: number) {
  const base = new Date(now);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0).toISOString();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "Medication",
    start: localIso(0, 9),
    createdAt: localIso(-1, 8),
    source: "local",
    readOnly: false,
    ...overrides,
  };
}

describe("task dashboard visibility", () => {
  it("keeps overdue reminders visible on the Today tab", () => {
    const overdueReminder = task({ start: localIso(-1, 9) });

    expect(taskVisibleInTab(overdueReminder, "today", now)).toBe(true);
    expect(taskVisibleInTab(overdueReminder, "upcoming", now)).toBe(false);
  });

  it("clears a stale alert after a refreshed snapshot says the task is no longer alerting", () => {
    const dismissed = task({ dismissedAt: localIso(0, 12) });

    expect(shouldClearTaskAlert([dismissed], { taskId: dismissed.id, name: dismissed.name }, now)).toBe(true);
  });

  it("keeps an alert for a still-due reminder", () => {
    const reminder = task({ start: localIso(0, 9) });

    expect(shouldClearTaskAlert([reminder], { taskId: reminder.id, name: reminder.name }, now)).toBe(false);
  });

  it("keeps alert-silenced due reminders visible without reopening the alert", () => {
    const reminder = task({
      start: localIso(-1, 9),
      alertDismissedAt: localIso(0, 12),
      alertDismissedFor: `${localIso(-1, 9)}:reminder`,
    });

    expect(taskVisibleInTab(reminder, "today", now)).toBe(true);
    expect(shouldClearTaskAlert([reminder], { taskId: reminder.id, name: reminder.name }, now)).toBe(true);
  });
});
