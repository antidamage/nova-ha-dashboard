import { expect, it } from "vitest";
import type { Task } from "./types";
import { isTaskCurrent, isTaskOverdue, timeRange } from "../app/components/tasks/task-model";
it("keeps a waiting device reminder inactive until its event", () => {
  const task: Task = { id: "wash", name: "Washing machine", source: "local", start: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", moduleData: { "washing-machine": { sessionId: "wash", phase: "waiting", soundFile: "done.mp3" } } };
  expect(isTaskCurrent(task, Date.now())).toBe(false);
  expect(isTaskOverdue(task, Date.now(), 1000)).toBe(false);
  expect(timeRange(task)).toContain("Waiting");
  task.moduleData!["washing-machine"] = { sessionId: "wash", phase: "active", soundFile: "done.mp3" };
  expect(isTaskCurrent(task, Date.now())).toBe(true);
});
