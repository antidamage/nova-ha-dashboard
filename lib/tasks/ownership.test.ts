import { describe, expect, it } from "vitest";
import {
  canSeeTask,
  canActOnTask,
  canWriteTask,
  effectiveOwner,
  HOUSEHOLD_VIEWER,
  SYSTEM_VIEWER,
  visibleRosterEntries,
  visibleTasks,
  type Viewer,
} from "./ownership";
import { task } from "./tasks.fixtures";

const alex: Viewer = { kind: "user", id: "alex" };
const lilith: Viewer = { kind: "user", id: "lilith" };
const mine = task({ id: "mine", name: "Medication", owner: "alex" });
const theirs = task({ id: "theirs", name: "Piano", owner: "lilith" });
const shared = task({ id: "shared", name: "Bins", owner: "alex", household: true });
const wash = task({ id: "wash", name: "Wash", moduleData: { "washing-machine": { sessionId: "s", phase: "active" } } });
const legacy = task({ id: "legacy", name: "Old" });

describe("canSeeTask", () => {
  it("shows a private reminder to its owner only", () => {
    expect(canSeeTask(mine, alex)).toBe(true);
    expect(canSeeTask(mine, lilith)).toBe(false);
    expect(canSeeTask(mine, HOUSEHOLD_VIEWER)).toBe(false);
  });

  it("shows household and washing reminders to everyone", () => {
    for (const viewer of [alex, lilith, HOUSEHOLD_VIEWER]) {
      expect(canSeeTask(shared, viewer)).toBe(true);
      expect(canSeeTask(wash, viewer)).toBe(true);
    }
  });

  it("shows system everything", () => {
    for (const each of [mine, theirs, shared, wash, legacy]) expect(canSeeTask(each, SYSTEM_VIEWER)).toBe(true);
  });

  it("hides a legacy reminder from every user until a legacy owner is set", () => {
    expect(canSeeTask(legacy, alex)).toBe(false);
    expect(canSeeTask(legacy, alex, "alex")).toBe(true);
    expect(canSeeTask(legacy, lilith, "alex")).toBe(false);
    expect(effectiveOwner(legacy, "alex")).toBe("alex");
    expect(effectiveOwner(wash, "alex")).toBeNull();
  });

  it("hides a reminder whose owner is no longer a user from every user", () => {
    const orphan = task({ owner: "gone" });
    expect(canSeeTask(orphan, alex)).toBe(false);
    expect(canSeeTask(orphan, SYSTEM_VIEWER)).toBe(true);
  });
});

describe("canWriteTask", () => {
  it("lets a user write their own and household reminders, never another user's", () => {
    expect(canWriteTask(mine, alex)).toBe(true);
    expect(canWriteTask(theirs, alex)).toBe(false);
    expect(canWriteTask(shared, lilith)).toBe(true);
  });

  it("lets the household view edit nothing", () => {
    expect(canWriteTask(shared, HOUSEHOLD_VIEWER)).toBe(false);
    expect(canWriteTask(wash, HOUSEHOLD_VIEWER)).toBe(false);
  });
});

describe("canActOnTask", () => {
  it("lets the household view complete or dismiss household and washing reminders, never a private one", () => {
    expect(canActOnTask(wash, HOUSEHOLD_VIEWER)).toBe(true);
    expect(canActOnTask(shared, HOUSEHOLD_VIEWER)).toBe(true);
    expect(canActOnTask(mine, HOUSEHOLD_VIEWER)).toBe(false);
    expect(canActOnTask(legacy, HOUSEHOLD_VIEWER, "alex")).toBe(false);
  });

  it("follows seeing for a user", () => {
    expect(canActOnTask(mine, alex)).toBe(true);
    expect(canActOnTask(theirs, alex)).toBe(false);
  });
});

describe("visibleTasks and the roster", () => {
  it("filters a list to what the viewer can see", () => {
    const all = [mine, theirs, shared, wash, legacy];
    expect(visibleTasks(all, alex).map((entry) => entry.id)).toEqual(["mine", "shared", "wash"]);
    expect(visibleTasks(all, HOUSEHOLD_VIEWER).map((entry) => entry.id)).toEqual(["shared", "wash"]);
    expect(visibleTasks(all, SYSTEM_VIEWER)).toHaveLength(5);
  });

  it("sends only the roster entries whose name the viewer can see", () => {
    const entries = [{ key: "medication" }, { key: "piano" }, { key: "bins" }];
    const all = [mine, theirs, shared];
    expect(visibleRosterEntries(entries, all, alex).map((entry) => entry.key)).toEqual(["medication", "bins"]);
    expect(visibleRosterEntries(entries, all, lilith).map((entry) => entry.key)).toEqual(["piano", "bins"]);
    expect(visibleRosterEntries(entries, all, SYSTEM_VIEWER)).toHaveLength(3);
  });
});