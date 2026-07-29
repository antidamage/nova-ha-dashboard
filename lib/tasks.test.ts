import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "./types";

const tempDirs: string[] = [];

async function isolatedTaskStore() {
  vi.resetModules();
  const dir = await mkdtemp(path.join(os.tmpdir(), "nova-tasks-"));
  tempDirs.push(dir);
  vi.stubEnv("NOVA_DASHBOARD_TASKS", path.join(dir, "tasks.json"));
  return import("./tasks");
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "Medication",
    start: new Date(Date.now() - 60_000).toISOString(),
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    source: "local",
    readOnly: false,
    ...overrides,
  };
}

describe("task notification dismissal", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("silences the alert without completing the task", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task()]);

    const dismissed = await store.dismissTaskAlert("task-1");

    expect(dismissed.dismissedAt).toBeUndefined();
    expect(dismissed.alertDismissedAt).toBeTruthy();
    expect(dismissed.alertDismissedFor).toBe(`${dismissed.start}:reminder`);
  });

  it("marks the chime spent for this occurrence without touching the alert", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task()]);

    const chimed = await store.markTaskAlertChimed("task-1");

    expect(chimed.alertChimedFor).toBe(`${chimed.start}:reminder`);
    // The banner is still up waiting for a tap -- only the sound is spent.
    expect(chimed.alertDismissedFor).toBeUndefined();
    expect(chimed.dismissedAt).toBeUndefined();
  });

  it("treats a dismissal as spending the chime too", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task()]);

    const dismissed = await store.dismissTaskAlert("task-1");

    expect(dismissed.alertChimedFor).toBe(`${dismissed.start}:reminder`);
  });

  it("frees the chime again when the reminder is rescheduled", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task()]);
    await store.markTaskAlertChimed("task-1");

    const moved = await store.updateTask("task-1", { start: new Date(Date.now() + 3_600_000).toISOString() });

    expect(moved.alertChimedFor).toBeUndefined();
  });

  it("keeps reminders quiet by default and honours an explicit annoyer opt-in", async () => {
    const store = await isolatedTaskStore();

    const quiet = await store.addTask({ name: "Wash hair", start: new Date().toISOString() });
    const nagging = await store.addTask({ name: "Take pills", start: new Date().toISOString(), annoy: true });

    expect(quiet.annoy).toBeUndefined();
    expect(nagging.annoy).toBe(true);
    expect((await store.updateTask(nagging.id, { annoy: false })).annoy).toBeUndefined();
  });

  it("completes the task only through the explicit completion path", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task()]);

    const completed = await store.completeTask("task-1");

    expect(completed.dismissedAt).toBeTruthy();
    expect(completed.alertDismissedAt).toBeUndefined();
    expect(completed.alertDismissedFor).toBeUndefined();
  });

  it("repairs repeating tasks that were accidentally marked done before their current occurrence", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({
        start: new Date(Date.now() + 86_400_000).toISOString(),
        dismissedAt: new Date(Date.now() - 86_400_000).toISOString(),
        repeat: { kind: "days", intervalDays: 1 },
      }),
    ]);

    const [repaired] = await store.readTasks();

    expect(repaired.dismissedAt).toBeUndefined();
  });
});
