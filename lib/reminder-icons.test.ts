import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "./types";

const tempDirs: string[] = [];

// The classifier is the one part of this module that reaches the network. It is
// stubbed per-test so the resolution ORDER can be asserted directly: what the
// keyword table decides, what the LLM is allowed to change, and what it is not.
const classifyReminderIcon = vi.fn<(name: string, timeoutMs: number) => Promise<string | null>>();

vi.mock("./voice-host-settings", () => ({
  classifyReminderIcon: (name: string, timeoutMs: number) => classifyReminderIcon(name, timeoutMs),
}));

vi.mock("./dashboard-events", () => ({
  publishReminderIcons: () => undefined,
}));

vi.mock("./dashboard-config", () => ({
  readDashboardConfig: async () => ({
    dashboard: { reminders: { classifier: { enabled: true, timeoutMs: 1000 } } },
  }),
}));

async function isolatedIconStore() {
  vi.resetModules();
  const dir = await mkdtemp(path.join(os.tmpdir(), "nova-reminder-icons-"));
  tempDirs.push(dir);
  vi.stubEnv("NOVA_DASHBOARD_REMINDER_ICONS", path.join(dir, "reminder-icons.json"));
  return import("./reminder-icons");
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    name: "Take estrogen",
    start: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    source: "local",
    readOnly: false,
    ...overrides,
  };
}

/** ensureReminderIcons kicks classification off without awaiting it. */
async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  classifyReminderIcon.mockReset();
  classifyReminderIcon.mockResolvedValue(null);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("assignment order", () => {
  it("uses the keyword table before asking the LLM anything", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Put the washing on" })]);

    const [entry] = await store.readReminderIcons();
    expect(entry.glyph).toEqual({ kind: "phosphor", id: "washing-machine" });
    expect(entry.source).toBe("keyword");
  });

  it("falls back to the bell when nothing matches and the LLM has no answer", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Qwrtp zzzyx" })]);
    await settle();

    const [entry] = await store.readReminderIcons();
    expect(entry.glyph).toEqual({ kind: "phosphor", id: "bell" });
    expect(entry.source).toBe("fallback");
  });

  it("lets the LLM upgrade a keyword guess", async () => {
    classifyReminderIcon.mockResolvedValue("syringe");
    const store = await isolatedIconStore();

    await store.ensureReminderIcons([task({ name: "Take estrogen" })]);
    await settle();

    const [entry] = await store.readReminderIcons();
    expect(entry.glyph).toEqual({ kind: "phosphor", id: "syringe" });
    expect(entry.source).toBe("llm");
  });

  it("never overwrites a choice the user made themselves", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Take estrogen" })]);
    const [seeded] = await store.readReminderIcons();

    await store.patchReminderIcon(seeded.key, { glyph: { kind: "text", value: "E" } });

    // A later classification round must not touch it.
    classifyReminderIcon.mockResolvedValue("pill");
    await store.ensureReminderIcons([task({ name: "Take estrogen" })]);
    await settle();

    const [entry] = await store.readReminderIcons();
    expect(entry.glyph).toEqual({ kind: "text", value: "E" });
    expect(entry.source).toBe("user");
  });

  it("survives a voice host that is down", async () => {
    classifyReminderIcon.mockRejectedValue(new Error("ECONNREFUSED"));
    const store = await isolatedIconStore();

    await expect(store.ensureReminderIcons([task({ name: "Pay rent" })])).resolves.toBeUndefined();
    await settle();

    const [entry] = await store.readReminderIcons();
    expect(entry.glyph).toEqual({ kind: "phosphor", id: "currency-dollar" });
  });
});

describe("stability across iCloud resync", () => {
  // The whole reason assignments are name-keyed: icloud-sync rebuilds every
  // mirrored task with a fresh id on each pass.
  it("keeps the user's icon when the task id changes underneath it", async () => {
    const store = await isolatedIconStore();
    const mirrored = task({
      id: "sha1-aaa",
      name: "Wash hair",
      source: "icloud-reminders",
      readOnly: true,
      recurs: true,
    });

    await store.ensureReminderIcons([mirrored]);
    const [seeded] = await store.readReminderIcons();
    await store.patchReminderIcon(seeded.key, { glyph: { kind: "phosphor", id: "bathtub" } });

    await store.ensureReminderIcons([{ ...mirrored, id: "sha1-bbb" } as typeof mirrored]);

    const entries = await store.readReminderIcons();
    expect(entries).toHaveLength(1);
    expect(entries[0].glyph).toEqual({ kind: "phosphor", id: "bathtub" });
  });
});

describe("bar membership", () => {
  it("auto-joins a repeating local reminder", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Bins out", repeat: { kind: "days", intervalDays: 7 } })]);

    const [entry] = await store.readReminderIcons();
    expect(entry.showInBar).toBe(true);
  });

  it("auto-joins a recurring iCloud reminder, which cannot carry `repeat`", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([
      task({ name: "Wash hair", source: "icloud-reminders", readOnly: true, recurs: true }),
    ]);

    const [entry] = await store.readReminderIcons();
    expect(entry.showInBar).toBe(true);
  });

  it("keeps a one-off out of the bar", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Book flights" })]);

    const [entry] = await store.readReminderIcons();
    expect(entry.showInBar).toBe(false);
  });

  it("respects a manual hide even though the reminder repeats", async () => {
    const store = await isolatedIconStore();
    const repeating = task({ name: "Bins out", repeat: { kind: "days", intervalDays: 7 } });

    await store.ensureReminderIcons([repeating]);
    const [seeded] = await store.readReminderIcons();
    await store.patchReminderIcon(seeded.key, { showInBar: false });

    // The auto-join rule must not undo the user on the next sync.
    await store.ensureReminderIcons([repeating]);

    const [entry] = await store.readReminderIcons();
    expect(entry.showInBar).toBe(false);
  });

  it("prunes an assignment once its reminder no longer exists", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Old reminder" })]);

    await store.pruneReminderIcons(new Set());

    await expect(store.readReminderIcons()).resolves.toEqual([]);
  });

  it("pins a one-off on request", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task({ name: "Book flights" })]);
    const [seeded] = await store.readReminderIcons();

    await store.patchReminderIcon(seeded.key, { showInBar: true });
    await store.ensureReminderIcons([task({ name: "Book flights" })]);

    const [entry] = await store.readReminderIcons();
    expect(entry.showInBar).toBe(true);
  });
});

describe("patch validation", () => {
  it("refuses an icon id that is not in the catalogue", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([task()]);
    const [seeded] = await store.readReminderIcons();

    await expect(
      store.patchReminderIcon(seeded.key, { glyph: { kind: "phosphor", id: "made-up" } }),
    ).rejects.toThrow(/Unknown reminder icon/);
  });

  it("reorders by explicit key order", async () => {
    const store = await isolatedIconStore();
    await store.ensureReminderIcons([
      task({ name: "Pay rent" }),
      task({ name: "Bins out" }),
      task({ name: "Wash hair" }),
    ]);

    const keys = (await store.readReminderIcons()).map((entry) => entry.key);
    await store.reorderReminderIcons([keys[2], keys[0], keys[1]]);

    expect((await store.readReminderIcons()).map((entry) => entry.key)).toEqual([
      keys[2],
      keys[0],
      keys[1],
    ]);
  });
});
