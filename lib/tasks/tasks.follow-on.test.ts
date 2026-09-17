import { rm } from "fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedTaskStore, task, tempDirs } from "./tasks.fixtures";

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
