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

  it("schedules a completed day-repeat from the completion, at 7am", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({
        start: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        repeat: { kind: "days", intervalDays: 3 },
      }),
    ]);

    const completed = await store.completeTask("task-1");
    const next = new Date(completed.start);
    const expected = new Date();
    expected.setDate(expected.getDate() + 3);

    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(0);
    expect(next.toDateString()).toBe(expected.toDateString());
    expect(completed.dismissedAt).toBeUndefined();
  });

  it("keeps hourly repeats on their fixed clock when completed", async () => {
    const store = await isolatedTaskStore();
    const start = new Date(Date.now() - 90 * 60_000);
    await store.writeTasks([task({ start: start.toISOString(), repeat: { kind: "hourly" } })]);

    const completed = await store.completeTask("task-1");
    const next = new Date(completed.start);

    expect(next.getMinutes()).toBe(start.getMinutes());
    expect(next.getTime()).toBeGreaterThan(Date.now());
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

describe("follow-on reminders", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("reschedules a follower when its anchor is completed", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({ id: "anchor", name: "Estrogen", repeat: { kind: "days", intervalDays: 3 } }),
      task({
        id: "follower",
        name: "Drink fluids",
        start: new Date(Date.now() - 86_400_000).toISOString(),
        dismissedAt: new Date(Date.now() - 86_000_000).toISOString(),
        follows: { taskId: "anchor", offsetDays: 1, hour: 18 },
      }),
    ]);

    await store.completeTask("anchor");
    const follower = (await store.readTasks()).find((candidate) => candidate.id === "follower");
    const expected = new Date();
    expected.setDate(expected.getDate() + 1);

    expect(follower?.dismissedAt).toBeUndefined();
    expect(new Date(follower!.start).toDateString()).toBe(expected.toDateString());
    expect(new Date(follower!.start).getHours()).toBe(18);
  });

  it("puts a follower back where it was when the anchor's completion is undone", async () => {
    const store = await isolatedTaskStore();
    const followerStart = new Date(Date.now() - 86_400_000).toISOString();
    await store.writeTasks([
      task({ id: "anchor", name: "Estrogen" }),
      task({
        id: "follower",
        name: "Drink fluids",
        start: followerStart,
        follows: { taskId: "anchor", offsetDays: 1, hour: 18 },
      }),
    ]);

    await store.completeTask("anchor");
    await store.uncompleteTask("anchor", 60_000);
    const follower = (await store.readTasks()).find((candidate) => candidate.id === "follower");

    expect(follower?.start).toBe(followerStart);
  });

  it("refuses a repeat and a follow link on the same reminder", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({ id: "anchor", name: "Estrogen" }),
      task({
        id: "follower",
        name: "Drink fluids",
        repeat: { kind: "days", intervalDays: 3 },
        follows: { taskId: "anchor", offsetDays: 1, hour: 18 },
      }),
    ]);

    const follower = (await store.readTasks()).find((candidate) => candidate.id === "follower");

    expect(follower?.follows?.taskId).toBe("anchor");
    expect(follower?.repeat).toBeUndefined();
  });

  it("drops the link when the anchor is deleted rather than leaving it dangling", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({ id: "anchor", name: "Estrogen" }),
      task({ id: "follower", name: "Drink fluids", follows: { taskId: "anchor", offsetDays: 1, hour: 18 } }),
    ]);

    await store.deleteTasks(["anchor"]);
    const follower = (await store.readTasks()).find((candidate) => candidate.id === "follower");

    expect(follower?.follows).toBeUndefined();
  });

  it("rejects a reminder that follows itself", async () => {
    const store = await isolatedTaskStore();

    await expect(
      store.writeTasks([task({ id: "loop", follows: { taskId: "loop", offsetDays: 1, hour: 18 } })]),
    ).rejects.toThrow(/cannot follow itself/i);
  });

  it("merges moduleData per module id instead of replacing it wholesale", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({
        id: "chores",
        moduleData: { "discord-bot": { onDue: true }, "other-module": { keep: 1 } },
      }),
    ]);

    // A partial write from one module's UI must not wipe the other's settings —
    // the same lesson mergeDashboardPreferences learned the hard way.
    const updated = await store.updateTask("chores", {
      moduleData: { "discord-bot": { onDue: false, onComplete: true } },
    });

    expect(updated.moduleData).toEqual({
      "discord-bot": { onDue: false, onComplete: true },
      "other-module": { keep: 1 },
    });
  });

  it("keeps moduleData across an unrelated edit", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task({ id: "chores", moduleData: { "discord-bot": { onDue: true } } })]);

    const updated = await store.updateTask("chores", { name: "Renamed" });

    expect(updated.name).toBe("Renamed");
    expect(updated.moduleData).toEqual({ "discord-bot": { onDue: true } });
  });

  it("sets moduleData on a mirrored reminder that updateTask would refuse", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({ id: "mirrored", source: "icloud-reminders", sourceId: "x", readOnly: true }),
    ]);

    await expect(store.updateTask("mirrored", { name: "nope" })).rejects.toThrow(/read-only/i);

    // Per-module state is dashboard-local state ABOUT a reminder, not a change
    // to the reminder, so a mirror can carry it.
    const updated = await store.setTaskModuleData("mirrored", "discord-bot", { onComplete: true });
    expect(updated.moduleData).toEqual({ "discord-bot": { onComplete: true } });
  });

  it("drops junk rather than storing it under moduleData", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([
      task({ id: "chores", moduleData: { "discord-bot": { ok: true }, "Bad Id": { x: 1 }, scalar: 5 } as Record<string, unknown> }),
    ]);

    const stored = (await store.readTasks()).find((candidate) => candidate.id === "chores");
    expect(stored?.moduleData).toEqual({ "discord-bot": { ok: true } });
  });

  it("clears a module's entry when it is set to null", async () => {
    const store = await isolatedTaskStore();
    await store.writeTasks([task({ id: "chores", moduleData: { "discord-bot": { onDue: true } } })]);

    const updated = await store.setTaskModuleData("chores", "discord-bot", null);
    expect(updated.moduleData).toBeUndefined();
  });
});
