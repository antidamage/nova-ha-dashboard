import { describe, expect, it } from "vitest";
import { findUser, isWashReminder, selectReminders } from "./assign-reminder-owner.mjs";

const users = [{ id: "alex", label: "alex" }, { id: "lilith", label: "Lilith" }];
const local = (extra) => ({ id: "t", name: "T", source: "local", readOnly: false, ...extra });

describe("selectReminders", () => {
  it("moves reminders with no owner and leaves owned, household and washing ones", () => {
    const tasks = [
      local({ id: "legacy" }),
      local({ id: "mine", owner: "alex" }),
      local({ id: "shared", household: true }),
      local({ id: "wash", moduleData: { "washing-machine": { sessionId: "s", phase: "active" } } }),
    ];
    expect(selectReminders(tasks, ["alex"]).move.map((task) => task.id)).toEqual(["legacy"]);
  });

  it("is safe to repeat: once owned, nothing moves", () => {
    expect(selectReminders([local({ id: "a", owner: "alex" })], ["alex"]).move).toEqual([]);
  });

  it("reports mirrored reminders instead of moving them", () => {
    const result = selectReminders([local({ id: "m", source: "icloud", readOnly: true })], ["alex"]);
    expect(result.move).toEqual([]);
    expect(result.skippedMirrored.map((task) => task.id)).toEqual(["m"]);
  });

  it("takes reminders of a removed user only with reclaim", () => {
    const orphan = local({ id: "o", owner: "gone" });
    expect(selectReminders([orphan], ["alex"]).move).toEqual([]);
    expect(selectReminders([orphan], ["alex"], { reclaim: true }).move.map((task) => task.id)).toEqual(["o"]);
  });
});

describe("findUser and isWashReminder", () => {
  it("finds a user by label, ignoring case, or by id", () => {
    expect(findUser(users, "alex")?.id).toBe("alex");
    expect(findUser(users, " LILITH ")?.id).toBe("lilith");
    expect(findUser(users, "nobody")).toBeNull();
  });

  it("recognises a washing reminder only with a valid phase", () => {
    expect(isWashReminder({ moduleData: { "washing-machine": { sessionId: "s", phase: "waiting" } } })).toBe(true);
    expect(isWashReminder({ moduleData: { "washing-machine": { sessionId: "s", phase: "x" } } })).toBe(false);
    expect(isWashReminder({})).toBe(false);
  });
});