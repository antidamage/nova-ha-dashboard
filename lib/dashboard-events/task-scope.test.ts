import { rm } from "fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedTaskStore, tempDirs } from "../tasks/tasks.fixtures";
import type { Viewer } from "../tasks/ownership";

const config = {
  dashboard: {
    people: [
      { id: "alex", label: "alex", rooms: ["room-a"] },
      { id: "lilith", label: "Lilith", rooms: ["room-b"] },
    ],
    reminders: { legacyOwner: "", clientViewers: [] },
  },
};
vi.mock("../dashboard-config", () => ({ readDashboardConfig: async () => config }));
vi.mock("../event-spool", () => ({ emitDashboardEvent: async () => undefined }));
vi.mock("../household-events", () => ({ appendTaskSnapshotEvents: async () => undefined }));
vi.mock("../modules/runtime/hooks", () => ({ emitModuleEvent: () => undefined }));

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const decoder = new TextDecoder();
function fakeClient(id: number, viewer: Viewer) {
  const received: string[] = [];
  const controller = { enqueue: (chunk: Uint8Array) => received.push(decoder.decode(chunk)) };
  return { client: { id, controller, viewer } as never, received };
}
const eventsOf = (received: string[], name: string) => received.filter((chunk) => chunk.startsWith(`event: ${name}`));
const idsIn = (chunk: string) => (JSON.parse(chunk.split("data: ")[1]).tasks as { id: string }[]).map((task) => task.id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("task events are built per connection", () => {
  it("sends each viewer only the reminders it can see, and washing to everyone", async () => {
    const tasks = await isolatedTaskStore();
    const { store } = await import("./store");
    const { publishTasks } = await import("./publish");
    const mine = await tasks.addTask({ name: "Medication", start: new Date().toISOString(), owner: "alex" });
    const theirs = await tasks.addTask({ name: "Piano", start: new Date().toISOString(), owner: "lilith" });
    const wash = await tasks.addTask({
      name: "Wash", start: new Date().toISOString(), owner: "alex",
      moduleData: { "washing-machine": { sessionId: "s", phase: "active" } },
    });
    const a = fakeClient(1, { kind: "user", id: "alex" });
    const l = fakeClient(2, { kind: "user", id: "lilith" });
    const h = fakeClient(3, { kind: "household" });
    for (const entry of [a, l, h]) store.taskClients.add(entry.client);
    publishTasks(await tasks.readTasks());
    await flush();
    expect(idsIn(eventsOf(a.received, "tasks")[0]).sort()).toEqual([mine.id, wash.id].sort());
    expect(idsIn(eventsOf(l.received, "tasks")[0]).sort()).toEqual([theirs.id, wash.id].sort());
    expect(idsIn(eventsOf(h.received, "tasks")[0])).toEqual([wash.id]);
    expect(eventsOf(l.received, "tasks")[0]).not.toContain("Medication");
  });

  it("alerts a private reminder only on its owner's connections; washing alerts reach all", async () => {
    const tasks = await isolatedTaskStore();
    const { store } = await import("./store");
    const { scanTaskAlerts } = await import("./task-alerts");
    const past = new Date(Date.now() - 60_000).toISOString();
    await tasks.addTask({ name: "Medication", start: past, owner: "alex" });
    await tasks.addTask({
      name: "Wash done", start: past, owner: "alex",
      moduleData: { "washing-machine": { sessionId: "s", phase: "active" } },
    });
    const a = fakeClient(1, { kind: "user", id: "alex" });
    const l = fakeClient(2, { kind: "user", id: "lilith" });
    for (const entry of [a, l]) store.taskClients.add(entry.client);
    await scanTaskAlerts();
    const names = (received: string[]) => eventsOf(received, "task-alert").map((chunk) => JSON.parse(chunk.split("data: ")[1]).name);
    expect(names(a.received).sort()).toEqual(["Medication", "Wash done"]);
    expect(names(l.received)).toEqual(["Wash done"]);
  });
});