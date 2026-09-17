// Shared isolated-store harness for the task suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { vi } from "vitest";
import type { Task } from "../types";

export const tempDirs: string[] = [];

export async function isolatedTaskStore() {
  vi.resetModules();
  const dir = await mkdtemp(path.join(os.tmpdir(), "nova-tasks-"));
  tempDirs.push(dir);
  vi.stubEnv("NOVA_DASHBOARD_TASKS", path.join(dir, "tasks.json"));
  return import("../tasks");
}

export function task(overrides: Partial<Task> = {}): Task {
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
