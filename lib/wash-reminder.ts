import type { Task } from "./types";

export type WashReminder = { sessionId: string; phase: "waiting" | "active"; soundFile: string };
export function washReminder(task: Pick<Task, "moduleData">): WashReminder | undefined {
  const value = task.moduleData?.["washing-machine"] as WashReminder | undefined;
  return value && typeof value.sessionId === "string" && (value.phase === "waiting" || value.phase === "active") ? value : undefined;
}
