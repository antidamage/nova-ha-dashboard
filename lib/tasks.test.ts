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
