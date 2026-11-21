import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolatedTaskStore, tempDirs } from "./tasks.fixtures";

const config = {
  dashboard: {
    people: [
      { id: "alex", label: "alex", rooms: ["room-a"] },
      { id: "lilith", label: "Lilith", rooms: ["room-b"] },
    ],
    reminders: { legacyOwner: "", clientViewers: [] as { userAgentContains: string; user: string }[] },
  },
};

vi.mock("../dashboard-config", () => ({ readDashboardConfig: async () => config }));

function request(headers: Record<string, string> = {}) {
  return new Request("http://nova.test/api/tasks", { headers });
}
const asAdeline = { cookie: "nova-viewer=alex" };
const asLilith = { cookie: "nova-viewer=lilith" };
const asHousehold = { cookie: "nova-viewer=household" };
const asSystem = { "x-nova-viewer": "system" };

beforeEach(() => {
  config.dashboard.reminders.legacyOwner = "";
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ownershipForNewTask", () => {
  it("makes a user's new reminder their own and ignores an owner in the body", async () => {
    const { readAccess, ownershipForNewTask } = await import("./access");
    const access = await readAccess(request(asAdeline));
    expect(ownershipForNewTask(access, { owner: "lilith" })).toEqual({ owner: "alex", household: undefined });
    expect(ownershipForNewTask(access, { household: true })).toEqual({ owner: "alex", household: true });
  });

  it("refuses the household view and an undecided device with 403", async () => {
    const { readAccess, ownershipForNewTask } = await import("./access");
    for (const headers of [asHousehold, {}]) {
      const access = await readAccess(request(headers));
      expect(() => ownershipForNewTask(access, {})).toThrowError(expect.objectContaining({ status: 403 }));
    }
  });

  it("makes a system caller name an owner or household", async () => {
    const { readAccess, ownershipForNewTask } = await import("./access");
    const access = await readAccess(request(asSystem));
    expect(() => ownershipForNewTask(access, {})).toThrowError(expect.objectContaining({ status: 400, code: "owner-required" }));
    expect(() => ownershipForNewTask(access, { owner: "nobody" })).toThrowError(expect.objectContaining({ code: "owner-unknown" }));
    expect(ownershipForNewTask(access, { owner: "lilith" })).toEqual({ owner: "lilith", household: undefined });
    expect(ownershipForNewTask(access, { household: true })).toEqual({ household: true });
  });
});

describe("writes to someone else's reminder", () => {
  it("answers 404 for a foreign id, the same as a missing one, and allows the owner", async () => {
    const tasks = await isolatedTaskStore();
    const { readAccess, requireWritableTasks } = await import("./access");
    const mine = await tasks.addTask({ name: "Medication", start: new Date().toISOString(), owner: "alex" });
    const lilithAccess = await readAccess(request(asLilith));
    await expect(requireWritableTasks(lilithAccess, [mine.id])).rejects.toMatchObject({ status: 404 });
    await expect(requireWritableTasks(lilithAccess, ["missing"])).rejects.toMatchObject({ status: 404 });
    const adelineAccess = await readAccess(request(asAdeline));
    await expect(requireWritableTasks(adelineAccess, [mine.id])).resolves.toHaveLength(1);
  });

  it("lets any user write a household reminder but not the household view", async () => {
    const tasks = await isolatedTaskStore();
    const { readAccess, requireWritableTasks } = await import("./access");
    const shared = await tasks.addTask({ name: "Bins", start: new Date().toISOString(), owner: "alex", household: true });
    await expect(requireWritableTasks(await readAccess(request(asLilith)), [shared.id])).resolves.toHaveLength(1);
    await expect(requireWritableTasks(await readAccess(request(asHousehold)), [shared.id])).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a whole batch if any item is foreign", async () => {
    const tasks = await isolatedTaskStore();
    const { readAccess, requireWritableTasks } = await import("./access");
    const a = await tasks.addTask({ name: "A", start: new Date().toISOString(), owner: "alex" });
    const b = await tasks.addTask({ name: "B", start: new Date().toISOString(), owner: "lilith" });
    await expect(requireWritableTasks(await readAccess(request(asAdeline)), [a.id, b.id])).rejects.toMatchObject({ status: 404 });
  });

  it("reads a legacy reminder as the legacy owner's", async () => {
    const tasks = await isolatedTaskStore();
    const { readAccess, requireWritableTasks } = await import("./access");
    const old = await tasks.addTask({ name: "Old", start: new Date().toISOString() });
    await expect(requireWritableTasks(await readAccess(request(asAdeline)), [old.id])).rejects.toMatchObject({ status: 404 });
    config.dashboard.reminders.legacyOwner = "alex";
    await expect(requireWritableTasks(await readAccess(request(asAdeline)), [old.id])).resolves.toHaveLength(1);
    await expect(requireWritableTasks(await readAccess(request(asLilith)), [old.id])).rejects.toMatchObject({ status: 404 });
  });
});

describe("accessPatchFor", () => {
  it("lets a user set household but not the owner; system may set both", async () => {
    const { readAccess, accessPatchFor } = await import("./access");
    const user = await readAccess(request(asAdeline));
    expect(accessPatchFor(user, { household: true, owner: "lilith" })).toEqual({ household: true });
    const system = await readAccess(request(asSystem));
    expect(accessPatchFor(system, { owner: "lilith" })).toEqual({ owner: "lilith" });
    expect(accessPatchFor(system, { owner: "nobody" })).toEqual({});
  });
});