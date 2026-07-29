import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Task } from "./types";

const tempDirs: string[] = [];

vi.mock("./reminder-icon-hook", () => ({
  assignReminderIcons: () => undefined,
  reconcileReminderIcons: () => undefined,
}));

async function isolatedTaskStore() {
  vi.resetModules();
  const dir = await mkdtemp(path.join(os.tmpdir(), "nova-reminder-undo-"));
  tempDirs.push(dir);
  vi.stubEnv("NOVA_DASHBOARD_TASKS", path.join(dir, "tasks.json"));
  return import("./tasks");
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const UNDO_WINDOW_MS = 10 * 60 * 1000;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("tap-to-complete undo", () => {
  it("restores a plain reminder", async () => {
    const store = await isolatedTaskStore();
    const created = await store.addTask({
      name: "Pay rent",
      start: new Date(Date.now() - HOUR).toISOString(),
    });

    const completed = await store.completeTask(created.id);
    expect(completed.dismissedAt).toBeTruthy();

    const restored = await store.uncompleteTask(created.id, UNDO_WINDOW_MS);
    expect(restored.dismissedAt).toBeUndefined();
    expect(restored.start).toBe(created.start);

    const [live] = await store.readTasks();
    expect(live.dismissedAt).toBeUndefined();
  });

  // The reason undo needs a snapshot rather than "clear dismissedAt":
  // completing a repeating reminder also rolls it to the next occurrence, so
  // the task the user tapped no longer exists in that shape.
  it("restores the occurrence that was tapped, not the one it rolled to", async () => {
    const store = await isolatedTaskStore();
    const start = new Date(Date.now() - 2 * HOUR).toISOString();
    const created = await store.addTask({
      name: "Take estrogen",
      start,
      repeat: { kind: "days", intervalDays: 1 },
    });

    const completed = await store.completeTask(created.id);
    expect(new Date(completed.start).getTime()).toBeGreaterThan(new Date(created.start).getTime());

    const restored = await store.uncompleteTask(created.id, UNDO_WINDOW_MS);
    expect(restored.start).toBe(created.start);
    expect(restored.dismissedAt).toBeUndefined();
  });

  it("restores a read-only iCloud mirror, which is completable but not editable", async () => {
    const store = await isolatedTaskStore();
    const start = new Date(Date.now() - 2 * HOUR).toISOString();
    await store.writeTasks([
      {
        id: "sha1-aaa",
        name: "Wash hair",
        start,
        end: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        createdAt: start,
        source: "icloud-reminders",
        readOnly: true,
        recurs: true,
      } satisfies Task,
    ]);

    await store.completeTask("sha1-aaa");
    const restored = await store.uncompleteTask("sha1-aaa", UNDO_WINDOW_MS);

    expect(restored.dismissedAt).toBeUndefined();
    expect(restored.start).toBe(start);
  });

  it("refuses once the window has closed", async () => {
    const store = await isolatedTaskStore();
    const created = await store.addTask({
      name: "Bins out",
      start: new Date(Date.now() - HOUR).toISOString(),
    });

    await store.completeTask(created.id);

    // A zero-length window is "already expired" by construction.
    await expect(store.uncompleteTask(created.id, 0)).rejects.toThrow(/no longer be undone/);
  });

  it("refuses a second undo of the same completion", async () => {
    const store = await isolatedTaskStore();
    const created = await store.addTask({
      name: "Bins out",
      start: new Date(Date.now() - HOUR).toISOString(),
    });

    await store.completeTask(created.id);
    await store.uncompleteTask(created.id, UNDO_WINDOW_MS);

    await expect(store.uncompleteTask(created.id, UNDO_WINDOW_MS)).rejects.toThrow(
      /no longer be undone/,
    );
  });

  it("reports the deadline while the offer stands, and nothing after", async () => {
    const store = await isolatedTaskStore();
    const created = await store.addTask({
      name: "Bins out",
      start: new Date(Date.now() - HOUR).toISOString(),
    });

    expect(store.completedTaskUndoDeadline(created.id, UNDO_WINDOW_MS)).toBeNull();
    await store.completeTask(created.id);
    expect(store.completedTaskUndoDeadline(created.id, UNDO_WINDOW_MS)).toBeGreaterThan(Date.now());
    expect(store.completedTaskUndoDeadline(created.id, 0)).toBeNull();
  });
});

describe("isTaskOverdue", () => {
  it("fires only past the threshold, and never for a completed reminder", async () => {
    const { isTaskOverdue } = await import("../app/components/tasks/task-model");
    const now = Date.now();

    const base: Task = {
      id: "t",
      name: "Take estrogen",
      start: new Date(now - 2 * DAY).toISOString(),
      createdAt: new Date(now - 3 * DAY).toISOString(),
      source: "local",
    };

    expect(isTaskOverdue(base, now, DAY)).toBe(true);
    expect(isTaskOverdue({ ...base, start: new Date(now - HOUR).toISOString() }, now, DAY)).toBe(false);
    expect(isTaskOverdue({ ...base, dismissedAt: new Date().toISOString() }, now, DAY)).toBe(false);
  });

  it("measures from the end when the reminder has one", async () => {
    const { isTaskOverdue } = await import("../app/components/tasks/task-model");
    const now = Date.now();

    // Started three days ago but only finished an hour ago: not overdue.
    const spanning: Task = {
      id: "t",
      name: "Long thing",
      start: new Date(now - 3 * DAY).toISOString(),
      end: new Date(now - HOUR).toISOString(),
      createdAt: new Date(now - 3 * DAY).toISOString(),
      source: "icloud-reminders",
      readOnly: true,
    };

    expect(isTaskOverdue(spanning, now, DAY)).toBe(false);
    expect(isTaskOverdue({ ...spanning, end: new Date(now - 2 * DAY).toISOString() }, now, DAY)).toBe(
      true,
    );
  });
});
