import { writeFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WashingMachineState } from "../washing-machine";
import { blockStartWallMs } from "../washing-machine/history-model";
import {
  BLOCK_19_SEP,
  BLOCK_20_SEP,
  BLOCK_21_SEP,
  cleanupWashStores,
  CONFIG,
  LATER,
  MORNING,
  scratch,
  seedTrace,
  seedWashes,
} from "./wash-store.fixtures";

/**
 * The wash graph's day blocks, in the household's own timezone
 * (specs/power-meters.md §5.2): which local day an instant falls in, the day
 * index that lets the graph skip empty days, and the washes — with their labels
 * and curves — that a day holds.
 *
 * `Pacific/Auckland` is UTC+12 through these fixtures (NZDT starts 2026-09-27),
 * so a local midnight is 12:00Z the day before and every block boundary in them
 * is deliberate.
 */

/** Two washes in two days between them; the first crosses local midnight. */
async function freshHistory(config: unknown = CONFIG) {
  const { config: configPath, data } = scratch();
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  seedWashes(data, { cycles: [MORNING, LATER], open: null, version: 1 });
  seedTrace(data, MORNING, [12.4, 380, 210.5]);
  seedTrace(data, LATER, [9.1, 96.2]);

  vi.resetModules();
  vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", configPath);
  vi.stubEnv("NOVA_DASHBOARD_POWER_DATA", data);
  const [washing, calendar] = await Promise.all([import("./washing"), import("./calendar")]);
  return { calendar, data, module: washing };
}

/** The block an instant falls in, resolved the way the graph's own maths does. */
function blockOf(calendar: Awaited<ReturnType<typeof freshHistory>>["calendar"], atMs: number) {
  return calendar.localInstantMs(blockStartWallMs(calendar.localWallMs(new Date(atMs))));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanupWashStores();
});

// Every case here imports the power module graph afresh against its own stubbed
// environment, which costs seconds on a loaded box.
vi.setConfig({ testTimeout: 30_000 });

describe("readWashHistory", () => {
  it("labels the day an instant falls in, in the household's timezone", async () => {
    const { module } = await freshHistory();

    const nineteenth = await module.readWashHistory(BLOCK_19_SEP);
    expect(nineteenth?.window).toEqual({
      dateLabel: "Sat 19 Sep 2026",
      endMs: BLOCK_20_SEP,
      startMs: BLOCK_19_SEP,
    });

    const twentieth = await module.readWashHistory(BLOCK_20_SEP + 5 * 60 * 60 * 1000);
    expect(twentieth?.window.dateLabel).toBe("Sun 20 Sep 2026");
    expect(twentieth?.window.startMs).toBe(BLOCK_20_SEP);
    expect(twentieth?.window.endMs).toBe(BLOCK_21_SEP);
  });

  it("lists every day holding a wash, oldest first, and no others", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(null);
    expect(history?.blocks).toEqual([BLOCK_19_SEP, BLOCK_20_SEP]);
  });

  it("reads the newest day holding a wash when no day is named", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(null);
    expect(history?.window.startMs).toBe(BLOCK_20_SEP);
    expect(history?.cycles.map((cycle) => cycle.id)).toEqual([MORNING.id, LATER.id]);
  });

  it("shows a wash crossing midnight in both days, and a later one only in its own", async () => {
    const { module } = await freshHistory();

    const nineteenth = await module.readWashHistory(BLOCK_19_SEP);
    const twentieth = await module.readWashHistory(BLOCK_20_SEP);
    const nextDay = await module.readWashHistory(BLOCK_21_SEP);
    // 11:00 PM–12:10 AM: its own day and the one it ran over into.
    expect(nineteenth?.cycles.map((cycle) => cycle.id)).toEqual([MORNING.id]);
    expect(twentieth?.cycles.map((cycle) => cycle.id)).toEqual([MORNING.id, LATER.id]);
    expect(nextDay?.cycles).toEqual([]);
  });

  it("labels each wash with its own local start time and duration", async () => {
    const { module } = await freshHistory();

    const twentieth = await module.readWashHistory(BLOCK_20_SEP);
    // A wash that started the night before reads as the one wash it was, with its
    // own start time, in the day it ran into as well as its own.
    expect(twentieth?.cycles.map((cycle) => [cycle.startLabel, cycle.durationLabel])).toEqual([
      ["11:00 PM", "1h 10m"],
      ["10:02 AM", "1h 12m"],
    ]);
    const nineteenth = await module.readWashHistory(BLOCK_19_SEP);
    expect(nineteenth?.cycles[0].startLabel).toBe("11:00 PM");
  });

  it("carries each wash's own curve, downsampled from its trace", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(BLOCK_19_SEP);
    expect(history?.cycles[0].curve).toEqual([12.4, 380, 210.5]);
  });

  it("reads an empty day as empty rather than as an error", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(Date.parse("2026-09-16T12:00:00.000Z"));
    expect(history?.window.dateLabel).toBe("Thu 17 Sep 2026");
    expect(history?.cycles).toEqual([]);
  });

  it("still labels the day holding now when there is no history at all", async () => {
    const { data, module } = await freshHistory();
    seedWashes(data, { cycles: [], open: null, version: 1 });

    const history = (await module.readWashHistory(null))!;
    const now = Date.now();
    expect(history.blocks).toEqual([]);
    expect(history.cycles).toEqual([]);
    expect(history.window.startMs).toBeLessThanOrEqual(now);
    expect(history.window.endMs).toBeGreaterThan(now);
    // A day block is a local day, so its real span is 24 hours — except across a
    // DST change, where the wall-clock day is 23 or 25 hours long.
    expect(history.window.endMs - history.window.startMs).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect(history.window.endMs - history.window.startMs).toBeLessThanOrEqual(25 * 3_600_000);
  });

  it("counts the wash under way, reads it as active, and makes its day the default", async () => {
    const { calendar, data, module } = await freshHistory();
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    seedWashes(data, {
      cycles: [MORNING, LATER],
      open: {
        aboveSince: startedAt,
        belowSince: null,
        costNzd: 0.01,
        kwh: 0.03,
        lastSampleAt: startedAt,
        lastWatts: 102.4,
        person: "addie",
        startedAt,
      },
      version: 1,
    });
    // The day holding now, which is where the graph opens while a wash runs —
    // a minute ago can be the previous day, and its wash is in both.
    const current = blockOf(calendar, Date.now());

    const history = await module.readWashHistory(current);
    const active = history?.cycles.find((cycle) => cycle.active);
    expect(history?.blocks).toContain(blockOf(calendar, Date.parse(startedAt)));
    expect((await module.readWashHistory(null))?.window.startMs).toBe(current);
    expect(active?.id).toBe(startedAt.replace(/[:.]/g, "-"));
    expect(active?.kwh).toBe(0.03);
    expect(active?.person).toBe("addie");
    expect(Date.parse(active!.endedAt)).toBeGreaterThanOrEqual(Date.parse(startedAt));
  });

  it("reports nothing when this household has no wash meter", async () => {
    const { module } = await freshHistory({
      dashboard: CONFIG.dashboard,
      power: { timeZone: "Pacific/Auckland" },
    });

    await expect(module.readWashHistory(null)).resolves.toBeNull();
  });
});
