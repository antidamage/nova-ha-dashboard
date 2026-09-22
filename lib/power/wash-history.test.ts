import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WashingMachineCycle, WashingMachineState } from "../washing-machine";
import { blockStartWallMs } from "../washing-machine/history-model";

/**
 * The wash graph's 12-hour blocks, in the household's own timezone
 * (specs/power-meters.md §5.2): which block an instant falls in, the block index
 * that lets the graph skip empty blocks, and the washed — with their curves — that
 * a block holds.
 *
 * `Pacific/Auckland` is UTC+12 through these fixtures (NZDT starts 2026-09-27),
 * so a local noon is 00:00Z and every block boundary in them is deliberate.
 */

const CONFIG = {
  dashboard: { people: [{ color: "#22d3ee", id: "addie", label: "Addie", primary: true }] },
  power: {
    timeZone: "Pacific/Auckland",
    washingMachine: {
      entityIds: ["switch.washing_machine"],
      powerSensorEntityId: "sensor.washing_machine_power",
    },
  },
};

/** 11:00–12:10 local on 19 Sep: one wash across the noon boundary. */
const MORNING: WashingMachineCycle = {
  costNzd: 0.171,
  endedAt: "2026-09-19T00:10:29.443Z",
  id: "2026-09-18T23-00-36-668Z",
  kwh: 0.61894,
  person: "tonya",
  startedAt: "2026-09-18T23:00:36.668Z",
};

/** 10:02–11:14 local on 20 Sep, in the next block's morning. */
const LATER: WashingMachineCycle = {
  costNzd: 0.0254,
  endedAt: "2026-09-19T23:14:39.396Z",
  id: "2026-09-19T22-02-26-095Z",
  kwh: 0.0921,
  person: "addie",
  startedAt: "2026-09-19T22:02:26.095Z",
};

const BLOCK_18_SEP_NOON = Date.parse("2026-09-18T12:00:00.000Z");
const BLOCK_19_SEP_MIDNIGHT = Date.parse("2026-09-19T00:00:00.000Z");
const BLOCK_19_SEP_NOON = Date.parse("2026-09-19T12:00:00.000Z");

const scratchDirs: string[] = [];

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-wash-"));
  scratchDirs.push(dir);
  const data = path.join(dir, "power");
  mkdirSync(path.join(data, "washing-machine-traces"), { recursive: true });
  const config = path.join(dir, "dashboard-config.json");
  writeFileSync(config, JSON.stringify(CONFIG), "utf8");
  return { config, data };
}

function seedWashes(data: string, state: WashingMachineState) {
  writeFileSync(path.join(data, "washing-machine.json"), JSON.stringify(state), "utf8");
}

/** A trace file: [seconds since the start, watts], as the meter writes them. */
function seedTrace(data: string, cycle: WashingMachineCycle, watts: number[]) {
  const points = watts.map((value, index): [number, number] => [index * 30, value]);
  writeFileSync(
    path.join(data, "washing-machine-traces", `${cycle.id}.json`),
    JSON.stringify({
      cycleId: cycle.id,
      endedAt: cycle.endedAt,
      kwh: cycle.kwh,
      person: cycle.person,
      points,
      startedAt: cycle.startedAt,
    }),
    "utf8",
  );
}

/** Two washes in three blocks between them; the first crosses a noon boundary. */
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
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
});

// Every case here imports the power module graph afresh against its own stubbed
// environment, which costs seconds on a loaded box.
vi.setConfig({ testTimeout: 30_000 });

describe("readWashHistory", () => {
  it("labels the block an instant falls in, in the household's timezone", async () => {
    const { module } = await freshHistory();

    const morning = await module.readWashHistory(BLOCK_18_SEP_NOON);
    expect(morning?.window).toEqual({
      dateLabel: "Sat 19 Sep 2026",
      endLabel: "12:00 PM",
      endMs: BLOCK_19_SEP_MIDNIGHT,
      startLabel: "12:00 AM",
      startMs: BLOCK_18_SEP_NOON,
    });

    const afternoon = await module.readWashHistory(BLOCK_19_SEP_MIDNIGHT + 5 * 60 * 60 * 1000);
    expect(afternoon?.window.startLabel).toBe("12:00 PM");
    expect(afternoon?.window.endLabel).toBe("12:00 AM");
    expect(afternoon?.window.dateLabel).toBe("Sat 19 Sep 2026");
    expect(afternoon?.window.endMs).toBe(BLOCK_19_SEP_NOON);
  });

  it("lists every block holding a wash, oldest first, and no others", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(null);
    expect(history?.blocks).toEqual([BLOCK_18_SEP_NOON, BLOCK_19_SEP_MIDNIGHT, BLOCK_19_SEP_NOON]);
  });

  it("reads the newest block holding a wash when no block is named", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(null);
    expect(history?.window.startMs).toBe(BLOCK_19_SEP_NOON);
    expect(history?.cycles.map((cycle) => cycle.id)).toEqual([LATER.id]);
  });

  it("shows a wash crossing the noon boundary in both blocks, and a later one only in its own", async () => {
    const { module } = await freshHistory();

    const morning = await module.readWashHistory(BLOCK_18_SEP_NOON);
    const afternoon = await module.readWashHistory(BLOCK_19_SEP_MIDNIGHT);
    const nextMorning = await module.readWashHistory(BLOCK_19_SEP_NOON);
    // 11:00–12:10 local: its first block and the one it ran over into.
    expect(morning?.cycles.map((cycle) => cycle.id)).toEqual([MORNING.id]);
    expect(afternoon?.cycles.map((cycle) => cycle.id)).toEqual([MORNING.id]);
    expect(nextMorning?.cycles.map((cycle) => cycle.id)).toEqual([LATER.id]);
  });

  it("carries each wash's own curve, downsampled from its trace", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(BLOCK_18_SEP_NOON);
    expect(history?.cycles[0].curve).toEqual([12.4, 380, 210.5]);
  });

  it("reads an empty block as empty rather than as an error", async () => {
    const { module } = await freshHistory();

    const history = await module.readWashHistory(Date.parse("2026-09-17T00:00:00.000Z"));
    expect(history?.window.dateLabel).toBe("Thu 17 Sep 2026");
    expect(history?.cycles).toEqual([]);
  });

  it("still labels the block holding now when there is no history at all", async () => {
    const { data, module } = await freshHistory();
    seedWashes(data, { cycles: [], open: null, version: 1 });

    const history = (await module.readWashHistory(null))!;
    const now = Date.now();
    expect(history.blocks).toEqual([]);
    expect(history.cycles).toEqual([]);
    expect(history.window.startMs).toBeLessThanOrEqual(now);
    expect(history.window.endMs).toBeGreaterThan(now);
    // A block is half a local day, so its real span is 12 hours — except across a
    // DST change, where the wall-clock half-day is 11 or 13 hours long.
    expect(history.window.endMs - history.window.startMs).toBeGreaterThanOrEqual(11 * 3_600_000);
    expect(history.window.endMs - history.window.startMs).toBeLessThanOrEqual(13 * 3_600_000);
  });

  it("counts the wash under way, reads it as active, and makes its block the default", async () => {
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
    // The block holding now, which is where the graph opens while a wash runs —
    // a minute ago can be the previous block, and its wash is in both.
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
