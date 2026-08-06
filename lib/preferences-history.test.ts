import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as history from "./preferences-history";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

/**
 * The module reads its directory from the environment on every call, so each
 * test simply points it at a fresh temp directory.
 */
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nova-history-"));
  process.env.NOVA_DASHBOARD_HISTORY = dir;
});

afterEach(async () => {
  delete process.env.NOVA_DASHBOARD_HISTORY;
  await rm(dir, { recursive: true, force: true });
});

const at = (minute: string, second = 0) => new Date(`${minute}:${String(second).padStart(2, "0")}.000Z`);

describe("revisions are minute buckets", () => {
  it("folds ten saves in one minute into a single revert point", async () => {
    let state: Record<string, unknown> = { phonoscope: { message: "0" } };
    await history.ensureGenesis(state);
    for (let step = 1; step <= 10; step += 1) {
      const next = { phonoscope: { message: String(step) } };
      await history.recordPreferencesRevision(state, next, at("2026-08-06T21:34", step));
      state = next;
    }
    const revisions = await history.listPreferencesRevisions();
    expect(revisions).toHaveLength(1);
    expect(revisions[0].id).toBe("2026-08-06T21:34");
    expect(revisions[0].changes).toBe(10);
  });

  it("winds that minute back to where it started, not to the ninth save", async () => {
    let state: Record<string, unknown> = { phonoscope: { message: "start" } };
    await history.ensureGenesis(state);
    for (const step of ["a", "b", "c"]) {
      const next = { phonoscope: { message: step } };
      await history.recordPreferencesRevision(state, next, at("2026-08-06T21:34", 10));
      state = next;
    }
    const before = await history.preferencesAtRevision("2026-08-06T21:34", { before: true });
    expect(before?.state).toEqual({ phonoscope: { message: "start" } });
    const after = await history.preferencesAtRevision("2026-08-06T21:34");
    expect(after?.state).toEqual({ phonoscope: { message: "c" } });
  });

  it("opens a new revert point when the minute rolls over", async () => {
    const one = { a: 1 };
    const two = { a: 2 };
    const three = { a: 3 };
    await history.ensureGenesis(one);
    await history.recordPreferencesRevision(one, two, at("2026-08-06T21:34"));
    await history.recordPreferencesRevision(two, three, at("2026-08-06T21:35"));
    const revisions = await history.listPreferencesRevisions();
    expect(revisions.map((revision) => revision.id))
      .toEqual(["2026-08-06T21:35", "2026-08-06T21:34"]);
  });
});

describe("what gets recorded", () => {
  it("ignores a save that only restamped updatedAt", async () => {
    const before = { voice: { enabled: true, updatedAt: "1" } };
    const after = { voice: { enabled: true, updatedAt: "2" } };
    await history.ensureGenesis(before);
    expect(await history.recordPreferencesRevision(before, after, at("2026-08-06T21:34")))
      .toBeNull();
    expect(await history.listPreferencesRevisions()).toHaveLength(0);
  });

  it("records a real change that happens to also restamp updatedAt", async () => {
    const before = { voice: { enabled: true, updatedAt: "1" } };
    const after = { voice: { enabled: false, updatedAt: "2" } };
    await history.ensureGenesis(before);
    const revision = await history.recordPreferencesRevision(before, after, at("2026-08-06T21:34"));
    expect(revision).not.toBeNull();
    expect(revision?.paths).toEqual(["/voice/enabled"]);
  });

  it("names the branch that moved, so the timeline reads usefully", async () => {
    const before = { phonoscope: { colorThemes: [{ id: "a" }] } };
    const after = { phonoscope: { colorThemes: [] } };
    await history.ensureGenesis(before);
    const revision = await history.recordPreferencesRevision(before, after, at("2026-08-06T21:34"));
    expect(revision?.paths).toEqual(["/phonoscope/colorThemes"]);
    expect(revision?.summary).toContain("Visualiser");
  });
});

describe("winding back a deletion", () => {
  /** The shape this whole feature exists for. */
  it("recovers colour themes deleted three revisions ago", async () => {
    const themes = [{ id: "hyperpop" }, { id: "battletech" }, { id: "shadow" }];
    const v0 = { phonoscope: { colorThemes: themes }, lighting: { zones: ["lounge"] } };
    await history.ensureGenesis(v0);

    const v1 = { phonoscope: { colorThemes: themes }, lighting: { zones: ["lounge", "kitchen"] } };
    await history.recordPreferencesRevision(v0, v1, at("2026-08-06T21:30"));

    // The accident.
    const v2 = { phonoscope: { colorThemes: [{ id: "shadow" }] }, lighting: { zones: ["lounge", "kitchen"] } };
    await history.recordPreferencesRevision(v1, v2, at("2026-08-06T21:31"));

    const v3 = { phonoscope: { colorThemes: [{ id: "shadow" }] }, lighting: { zones: [] } };
    await history.recordPreferencesRevision(v2, v3, at("2026-08-06T21:32"));

    const before = await history.preferencesAtRevision("2026-08-06T21:31", { before: true });
    expect(before?.state).toEqual(v1);

    // Restore only the themes; the lighting change made since must survive.
    const restored = history.restoreSubtrees(v3, before!.state, ["/phonoscope/colorThemes"]);
    expect(restored).toEqual({
      phonoscope: { colorThemes: themes },
      lighting: { zones: [] },
    });
  });

  it("restores a branch that did not change at that revision", async () => {
    const v0 = { lighting: { zones: ["lounge"] }, voice: { enabled: true } };
    await history.ensureGenesis(v0);
    const v1 = { lighting: { zones: ["lounge"] }, voice: { enabled: false } };
    await history.recordPreferencesRevision(v0, v1, at("2026-08-06T21:30"));
    const v2 = { lighting: { zones: [] }, voice: { enabled: false } };
    await history.recordPreferencesRevision(v1, v2, at("2026-08-06T21:31"));

    // Lighting was untouched at 21:30, but its value then is still knowable.
    const then = await history.preferencesAtRevision("2026-08-06T21:30");
    expect(history.restoreSubtrees(v2, then!.state, ["/lighting"]))
      .toEqual({ lighting: { zones: ["lounge"] }, voice: { enabled: false } });
  });

  it("takes a branch away again when it did not exist at that revision", async () => {
    const v0 = { voice: { enabled: true } };
    await history.ensureGenesis(v0);
    const v1 = { voice: { enabled: true }, doorbell: { chime: "ding" } };
    await history.recordPreferencesRevision(v0, v1, at("2026-08-06T21:30"));

    const then = await history.preferencesAtRevision("2026-08-06T21:30", { before: true });
    expect(history.restoreSubtrees(v1, then!.state, ["/doorbell"])).toEqual({ voice: { enabled: true } });
  });
});

describe("the selectable tree", () => {
  it("offers every branch, marking the ones this revision moved", async () => {
    const v0 = { phonoscope: { colorThemes: [{ id: "a" }] }, lighting: { zones: ["lounge"] } };
    await history.ensureGenesis(v0);
    const v1 = { phonoscope: { colorThemes: [] }, lighting: { zones: ["lounge"] } };
    const revision = await history.recordPreferencesRevision(v0, v1, at("2026-08-06T21:30"));

    const tree = history.buildHistoryTree(v0, v1, revision!.patch);
    const byPointer = Object.fromEntries(tree.map((node) => [node.pointer, node]));
    expect(Object.keys(byPointer).sort()).toEqual(["/lighting", "/phonoscope"]);
    expect(byPointer["/phonoscope"].changed).toBe(true);
    // Untouched, but still selectable — that is the requirement.
    expect(byPointer["/lighting"].changed).toBe(false);
  });

  it("flags a branch that existed then and is gone now", async () => {
    const then = { doorbell: { chime: "ding" } };
    const now = {};
    const tree = history.buildHistoryTree(then, now, []);
    expect(tree.find((node) => node.pointer === "/doorbell")?.status).toBe("missing-now");
  });
});

describe("what a revision reports", () => {
  it("hands back its own patch, so the tree can mark what moved", async () => {
    // Regression: the API built the tree with an empty patch, so nothing was
    // ever flagged as changed and every branch looked equally untouched.
    const v0 = { phonoscope: { transitionMs: 600 } };
    await history.ensureGenesis(v0);
    await history.recordPreferencesRevision(
      v0, { phonoscope: { transitionMs: 601 } }, at("2026-08-06T21:40"));

    const found = await history.preferencesAtRevision("2026-08-06T21:40", { before: true });
    expect(found?.patch.length).toBeGreaterThan(0);
    const tree = history.buildHistoryTree(found!.state, { phonoscope: { transitionMs: 601 } },
      found!.patch);
    expect(tree.find((node) => node.pointer === "/phonoscope")?.changed).toBe(true);
  });

  it("does not count the updatedAt stamp as a change of its own", async () => {
    const v0 = { phonoscope: { transitionMs: 600, updatedAt: "1" } };
    await history.ensureGenesis(v0);
    const revision = await history.recordPreferencesRevision(
      v0, { phonoscope: { transitionMs: 601, updatedAt: "2" } }, at("2026-08-06T21:41"));
    expect(revision?.summary).toBe("Visualiser — 1 changed");
  });
});
