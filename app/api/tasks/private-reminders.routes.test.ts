import { rm } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isolatedTaskStore, tempDirs } from "../../../lib/tasks/tasks.fixtures";

const config = {
  dashboard: {
    people: [
      { id: "alex", label: "alex", rooms: ["room-a"] },
      { id: "lilith", label: "Lilith", rooms: ["room-b"] },
    ],
    reminders: { legacyOwner: "", clientViewers: [], undoWindowMs: 600_000 },
  },
};
vi.mock("../../../lib/dashboard-config", () => ({ readDashboardConfig: async () => config }));
vi.mock("../../../lib/event-spool", () => ({ emitDashboardEvent: async () => undefined }));
vi.mock("../../../lib/household-events", () => ({ appendTaskSnapshotEvents: async () => undefined }));
vi.mock("../../../lib/modules/runtime/hooks", () => ({ emitModuleEvent: () => undefined }));
vi.mock("../../../lib/reminder-icon-hook", () => ({ assignReminderIcons: () => undefined, reconcileReminderIcons: () => undefined }));

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const asAdeline = { cookie: "nova-viewer=alex" };
const asLilith = { cookie: "nova-viewer=lilith" };
const asHousehold = { cookie: "nova-viewer=household" };
const asSystem = { "x-nova-viewer": "system" };
const soon = () => new Date(Date.now() + 3_600_000).toISOString();

function call(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  return new Request(`http://nova.test${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup() {
  const tasks = await isolatedTaskStore();
  const list = await import("./route");
  const one = await import("./[id]/route");
  const complete = await import("./[id]/complete/route");
  const dismiss = await import("./[id]/dismiss/route");
  const bulk = await import("./bulk/route");
  const mine = await tasks.addTask({ name: "Medication", start: soon(), owner: "alex" });
  const theirs = await tasks.addTask({ name: "Piano", start: soon(), owner: "lilith" });
  const wash = await tasks.addTask({
    name: "Wash done", start: soon(), owner: "alex",
    moduleData: { "washing-machine": { sessionId: "s", phase: "active" } },
  });
  return { tasks, list, one, complete, dismiss, bulk, mine, theirs, wash };
}

const listIds = async (route: { GET: (r: Request) => Promise<Response> }, headers: Record<string, string>) =>
  ((await (await route.GET(call("/api/tasks?command=list", { headers }))).json()).tasks as { id: string }[]).map((task) => task.id);

describe("reads", () => {
  it("lists only what the viewer may see", async () => {
    const { list, mine, theirs, wash } = await setup();
    expect((await listIds(list, asAdeline)).sort()).toEqual([mine.id, wash.id].sort());
    expect((await listIds(list, asLilith)).sort()).toEqual([theirs.id, wash.id].sort());
    expect(await listIds(list, asHousehold)).toEqual([wash.id]);
    expect(await listIds(list, {})).toEqual([wash.id]);
    expect(await listIds(list, asSystem)).toHaveLength(3);
  });
});

describe("add", () => {
  it("makes a user's reminder their own, whatever the body says", async () => {
    const { list } = await setup();
    const response = await list.POST(call("/api/tasks", { method: "POST", headers: asLilith, body: { command: "add", name: "Stretch", start: soon(), owner: "alex" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).owner).toBe("lilith");
  });

  it("refuses the household view and an undecided device with 403", async () => {
    const { list } = await setup();
    for (const headers of [asHousehold, {}]) {
      const response = await list.POST(call("/api/tasks", { method: "POST", headers, body: { command: "add", name: "X", start: soon() } }));
      expect(response.status).toBe(403);
    }
  });

  it("makes a system caller name an owner", async () => {
    const { list } = await setup();
    const none = await list.POST(call("/api/tasks", { method: "POST", headers: asSystem, body: { command: "add", name: "X", start: soon() } }));
    expect(none.status).toBe(400);
    const ok = await list.POST(call("/api/tasks", { method: "POST", headers: asSystem, body: { command: "add", name: "X", start: soon(), owner: "lilith" } }));
    expect(ok.status).toBe(200);
  });

  it("refuses a follows anchor the viewer cannot write, as a missing id", async () => {
    const { list, theirs } = await setup();
    const response = await list.POST(call("/api/tasks", {
      method: "POST", headers: asAdeline,
      body: { command: "add", name: "Follower", start: soon(), follows: { taskId: theirs.id, offsetDays: 1, hour: 9 } },
    }));
    expect(response.status).toBe(404);
  });
});

describe("writes to another user's reminder", () => {
  it("answers 404 on patch, delete, complete and dismiss, and changes nothing", async () => {
    const { one, complete, dismiss, theirs, tasks } = await setup();
    const patch = await one.PATCH(call(`/api/tasks/${theirs.id}`, { method: "PATCH", headers: asAdeline, body: { name: "Hijack", start: theirs.start } }), ctx(theirs.id));
    const del = await one.DELETE(call(`/api/tasks/${theirs.id}`, { method: "DELETE", headers: asAdeline }), ctx(theirs.id));
    const done = await complete.POST(call(`/api/tasks/${theirs.id}/complete`, { method: "POST", headers: asAdeline }), ctx(theirs.id));
    const dis = await dismiss.POST(call(`/api/tasks/${theirs.id}/dismiss`, { method: "POST", headers: asAdeline }), ctx(theirs.id));
    expect([patch.status, del.status, done.status, dis.status]).toEqual([404, 404, 404, 404]);
    expect((await tasks.readTasks()).find((task) => task.id === theirs.id)?.name).toBe("Piano");
  });

  it("lets the owner write", async () => {
    const { one, mine } = await setup();
    const response = await one.PATCH(call(`/api/tasks/${mine.id}`, { method: "PATCH", headers: asAdeline, body: { name: "Medication (renamed)", start: mine.start } }), ctx(mine.id));
    expect(response.status).toBe(200);
  });

  it("lets a user set household on their own reminder but not change its owner", async () => {
    const { one, mine } = await setup();
    const response = await one.PATCH(call(`/api/tasks/${mine.id}`, { method: "PATCH", headers: asAdeline, body: { name: mine.name, start: mine.start, household: true, owner: "lilith" } }), ctx(mine.id));
    const body = await response.json();
    expect(body.household).toBe(true);
    expect(body.owner).toBe("alex");
  });
});

describe("the household view and a washing reminder", () => {
  it("can dismiss a wash alert but not delete the reminder or touch a private one", async () => {
    const { one, dismiss, wash, mine } = await setup();
    const dis = await dismiss.POST(call(`/api/tasks/${wash.id}/dismiss`, { method: "POST", headers: asHousehold }), ctx(wash.id));
    const del = await one.DELETE(call(`/api/tasks/${wash.id}`, { method: "DELETE", headers: asHousehold }), ctx(wash.id));
    const priv = await dismiss.POST(call(`/api/tasks/${mine.id}/dismiss`, { method: "POST", headers: asHousehold }), ctx(mine.id));
    expect([dis.status, del.status, priv.status]).toEqual([200, 404, 404]);
  });
});

describe("bulk import", () => {
  it("gives every imported reminder the importing user, and takes an owner from a system caller", async () => {
    const { bulk, list } = await setup();
    const csv = `${soon()},,Stretch`;
    const asUser = await bulk.POST(call("/api/tasks/bulk", { method: "POST", headers: asLilith, body: { csv } }));
    expect(asUser.status).toBe(200);
    expect((await asUser.json()).created.map((task: { owner: string }) => task.owner)).toEqual(["lilith"]);
    const system = await bulk.POST(call("/api/tasks/bulk", { method: "POST", headers: asSystem, body: { csv, owner: "alex" } }));
    expect((await system.json()).created[0].owner).toBe("alex");
    const none = await bulk.POST(call("/api/tasks/bulk", { method: "POST", headers: asHousehold, body: { csv } }));
    expect(none.status).toBe(403);
    expect(list).toBeTruthy();
  });
});

describe("chime preferences", () => {
  it("are per user, default on, and only a user may write", async () => {
    await isolatedTaskStore();
    vi.stubEnv("NOVA_REMINDER_USER_PREFS", path.join(tempDirs[0], "prefs.json"));
    const prefs = await import("../reminders/prefs/route");
    const read = async (headers: Record<string, string>) => (await (await prefs.GET(call("/api/reminders/prefs", { headers }))).json()).chime;
    expect(await read(asAdeline)).toBe(true);
    const off = await prefs.PUT(call("/api/reminders/prefs", { method: "PUT", headers: asAdeline, body: { chime: false } }));
    expect(off.status).toBe(200);
    expect(await read(asAdeline)).toBe(false);
    expect(await read(asLilith)).toBe(true);
    expect(await read(asHousehold)).toBe(true);
    const refused = await prefs.PUT(call("/api/reminders/prefs", { method: "PUT", headers: asHousehold, body: { chime: false } }));
    expect(refused.status).toBe(403);
  });
});

describe("the icon roster", () => {
  it("answers a foreign or unknown name with the same 404", async () => {
    const { theirs } = await setup();
    const icons = await import("../reminders/icons/route");
    const foreign = await icons.PATCH(call("/api/reminders/icons", { method: "PATCH", headers: asAdeline, body: { key: "piano", showInBar: true } }));
    const unknown = await icons.PATCH(call("/api/reminders/icons", { method: "PATCH", headers: asAdeline, body: { key: "nothing-called-this", showInBar: true } }));
    expect([foreign.status, unknown.status]).toEqual([404, 404]);
    expect(theirs.name).toBe("Piano");
  });
});