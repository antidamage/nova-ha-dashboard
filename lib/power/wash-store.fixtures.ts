// The wash suites' scratch store: a household config, two washes and their trace
// files, written into a temp directory per case and pointed at with the two
// environment variables the power store takes its paths from (§4, §4.6).
//
// Shared by `wash-history.test.ts` (the graph's day blocks, §5.2) and
// `wash-detail.test.ts` (one wash's own sheet, §5.3): each case needs the same
// four things written to disk, and neither file may carry its own copy of them —
// the repo's 10 KB cap counts test files too (specs/agent-token-footprint.md §2).
//
// NOT a suite. vitest collects `*.test.*` and `*.spec.*`, not `*.fixtures.*`, and
// product source is forbidden from importing a fixtures helper at all.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { WashingMachineCycle, WashingMachineState } from "../washing-machine";

/**
 * `Pacific/Auckland` is UTC+12 through these fixtures (NZDT starts 2026-09-27), so
 * a local midnight is 12:00Z the day before and every block boundary in them is
 * deliberate.
 */
export const CONFIG = {
  dashboard: { people: [{ color: "#22d3ee", id: "addie", label: "Addie", primary: true }] },
  power: {
    timeZone: "Pacific/Auckland",
    washingMachine: {
      entityIds: ["switch.washing_machine"],
      powerSensorEntityId: "sensor.washing_machine_power",
    },
  },
};

/** 11:00 PM–12:10 AM local, 19 into 20 Sep: one wash across local midnight. */
export const MORNING: WashingMachineCycle = {
  costNzd: 0.171,
  endedAt: "2026-09-19T12:10:29.443Z",
  id: "2026-09-19T11-00-36-668Z",
  kwh: 0.61894,
  person: "tonya",
  startedAt: "2026-09-19T11:00:36.668Z",
};

/** 10:02–11:14 AM local on 20 Sep, in the same day the wash above ran into. */
export const LATER: WashingMachineCycle = {
  costNzd: 0.0254,
  endedAt: "2026-09-19T23:14:39.396Z",
  id: "2026-09-19T22-02-26-095Z",
  kwh: 0.0921,
  person: "addie",
  startedAt: "2026-09-19T22:02:26.095Z",
};

export const BLOCK_19_SEP = Date.parse("2026-09-18T12:00:00.000Z");
export const BLOCK_20_SEP = Date.parse("2026-09-19T12:00:00.000Z");
export const BLOCK_21_SEP = Date.parse("2026-09-20T12:00:00.000Z");

const scratchDirs: string[] = [];

/** A temp data directory with a household config, and its own trace directory. */
export function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-wash-"));
  scratchDirs.push(dir);
  const data = path.join(dir, "power");
  mkdirSync(path.join(data, "washing-machine-traces"), { recursive: true });
  const config = path.join(dir, "dashboard-config.json");
  writeFileSync(config, JSON.stringify(CONFIG), "utf8");
  return { config, data };
}

export function seedWashes(data: string, state: WashingMachineState) {
  writeFileSync(path.join(data, "washing-machine.json"), JSON.stringify(state), "utf8");
}

/** A trace file: [seconds since the start, watts], as the meter writes them. */
export function seedTrace(data: string, cycle: WashingMachineCycle, watts: number[]) {
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

/** The open wash's own trace: [epoch seconds, watts], keyed by the instant it started (§4.6). */
export function seedOpenTrace(data: string, startedAt: string, samples: Array<[number, number]>) {
  writeFileSync(
    path.join(data, "washing-machine-traces", "open.json"),
    JSON.stringify({ anchor: startedAt, points: samples }),
    "utf8",
  );
}

/** Every scratch directory a case made, gone. Call it from `afterEach`. */
export function cleanupWashStores() {
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop()!, { recursive: true, force: true });
  }
}
