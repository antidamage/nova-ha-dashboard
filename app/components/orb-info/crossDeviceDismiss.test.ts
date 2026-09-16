import { describe, expect, it } from "vitest";
import { orbModuleById } from "../../../lib/orb-info/catalogue";
import type { Task } from "../../../lib/types";
import { applyTaskDismissal, dismissalKey, tasksSourceFrom } from "./useOrbInfo";

const base = { watchface: null, novaLoad: null, power: null, dashboardState: null } as const;

describe("a dismissal broadcast from another screen", () => {
  it("clears a due reminder alert from the task-dismiss event alone", () => {
    const tasks = [{ id: "r1", name: "Bins", start: new Date(1000).toISOString(), createdAt: "", source: "local" } as unknown as Task];
    const before = orbModuleById("reminders-overdue").read({ ...base, now: 5000, tasks: tasksSourceFrom(tasks, 5000) });
    expect(before).toMatchObject({ alert: true, dismiss: { kind: "reminder", id: "r1" } });
    const after = applyTaskDismissal(tasks, "r1");
    expect(orbModuleById("reminders-overdue").read({ ...base, now: 5000, tasks: tasksSourceFrom(after, 5000) }).alert).toBe(false);
  });
  it("clears a completed wash without waiting for the task list push", () => {
    const tasks = [{ id: "wash", name: "Wash", start: new Date(0).toISOString(), createdAt: "", source: "local",
      moduleData: { "washing-machine": { phase: "active", sessionId: "s", soundFile: "" } } } as unknown as Task];
    const read = (list: Task[]) => orbModuleById("washing").read({ ...base, tasks: null, now: 1000, washTasks: list, washing: null });
    expect(read(tasks)).toMatchObject({ alert: true, dismiss: { kind: "washing", id: "wash" } });
    expect(read(applyTaskDismissal(tasks, "wash")).active).toBe(false);
    expect(applyTaskDismissal(tasks, "other")).toEqual(tasks);
  });
});

describe("dismissal bookkeeping", () => {
  const task = { id: "bins", name: "Bins", start: new Date(1000).toISOString(), createdAt: "", source: "local" } as unknown as Task;
  it("keys a dismissal per occurrence, so the next occurrence still shows", () => {
    const first = orbModuleById("reminders-overdue").read({ ...base, now: 5000, tasks: tasksSourceFrom([task], 5000) });
    const rolled = { ...task, start: new Date(90_000).toISOString() };
    const second = orbModuleById("reminders-overdue").read({ ...base, now: 95_000, tasks: tasksSourceFrom([rolled], 95_000) });
    expect(dismissalKey(first)).not.toBe(dismissalKey(second));
  });
  it("re-acknowledges a rolled-forward occurrence rather than skipping it", () => {
    const acknowledged = applyTaskDismissal([task], "bins")[0];
    expect(applyTaskDismissal([acknowledged], "bins")[0]).toBe(acknowledged);
    // A new occurrence carries the old alertDismissedFor until it is dismissed again.
    const rolled = [{ ...acknowledged, start: new Date(90_000).toISOString() }];
    const redismissed = applyTaskDismissal(rolled, "bins")[0];
    expect(redismissed.alertDismissedFor).toBe(`${rolled[0].start}:reminder`);
    expect(tasksSourceFrom([redismissed], 95_000).alerting).toEqual([]);
  });
});
