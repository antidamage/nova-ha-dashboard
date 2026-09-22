// Shared harness for the wash's timer suites. It is deliberately not a
// `*.test.*` file: vitest collects those by glob, and a helper must not be
// collected as a suite of its own.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { vi } from "vitest";
import type { HaState } from "../types";
import type { WashingMachineOpenCycle, WashingMachineState } from "../washing-machine";

export const NOW = Date.parse("2026-09-22T02:00:00.000Z");
export const MINUTE = 60_000;

/** The household's own timer icon list, first entry first — Adeline's "Wash clothes". */
export const HOUSEHOLD = {
  dashboard: { people: [
    { color: "#22d3ee", id: "addie", label: "Addie", primary: true },
    { color: "#e879f9", id: "tonya", label: "Tonya" },
  ] },
  power: {
    timeZone: "Pacific/Auckland",
    washingMachine: {
      entityIds: ["switch.washing_machine"],
      powerSensorEntityId: "sensor.washing_machine_power",
      timer: { extendMinutes: 10, firstPeriodMinutes: 70, maxSampleGapSeconds: 90, stopSeconds: 120, stopWatts: 5 },
    },
  },
};

export type TimerFile = { autoComplete: boolean; completedAt: number | null; dismissedAt: number | null;
  durationMs: number; endsAt: number; icon: string; id: string; label: string; startedAt: number };

const scratchDirs: string[] = [];

export function scratch({ household = HOUSEHOLD, runningTimer = false, timerIcons = [{ glyph: { id: "tshirt", kind: "phosphor" }, id: "timer", label: "Wash clothes" }] as unknown } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-wash-timer-"));
  scratchDirs.push(dir);
  const data = path.join(dir, "power");
  mkdirSync(path.join(data, "washing-machine-traces"), { recursive: true });
  const config = path.join(dir, "dashboard-config.json");
  writeFileSync(config, JSON.stringify(household), "utf8");
  const preferences = path.join(dir, "dashboard-preferences.json");
  writeFileSync(preferences, JSON.stringify({ orbInfo: { timerIcons } }), "utf8");
  const timerFile = path.join(dir, "orb-timer.json");
  if (runningTimer) {
    writeFileSync(timerFile, JSON.stringify({ notified: false, soundSlot: -1, timer: {
      autoComplete: true, completedAt: null, dismissedAt: null, durationMs: 1_800_000, endsAt: NOW + 1_200_000,
      icon: "fork-knife", id: "oven", label: "Check oven", startedAt: NOW,
    } }), "utf8");
  }
  return { config, data, preferences, timerFile };
}

export function cleanUp() {
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop()!, { force: true, recursive: true });
  }
}

/** An open wash that began `minutes` ago, claimed by nobody yet. */
export function openWash(minutes: number, person: string | null = null): WashingMachineState {
  const open: WashingMachineOpenCycle = {
    aboveSince: null, belowSince: null, costNzd: 0, kwh: 0.2, lastSampleAt: new Date(NOW).toISOString(),
    lastWatts: 220, person, startedAt: new Date(NOW - minutes * 60_000).toISOString(),
  };
  return { cycles: [], open, version: 1 };
}

const washFile = (data: string) => path.join(data, "washing-machine.json");
export const seed = (data: string, state: WashingMachineState) => writeFileSync(washFile(data), JSON.stringify(state), "utf8");
export const readWash = (data: string) => JSON.parse(readFileSync(washFile(data), "utf8")) as WashingMachineState;
export const readTimer = (file: string) => JSON.parse(readFileSync(file, "utf8")).timer as TimerFile | null;
export const writeTimer = (file: string, timer: TimerFile) => writeFileSync(file, JSON.stringify({ notified: false, soundSlot: -1, timer }), "utf8");

export async function fresh(configPath: string, data: string, preferences: string, timerFile: string) {
  vi.resetModules();
  vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", configPath);
  vi.stubEnv("NOVA_DASHBOARD_POWER_DATA", data);
  vi.stubEnv("NOVA_DASHBOARD_PREFERENCES", preferences);
  vi.stubEnv("NOVA_ORB_TIMER_FILE", timerFile);
  const [washing, timer] = await Promise.all([import("./washing"), import("./wash-timer")]);
  return { timer, washing };
}

/** The meter's own reading of the wash plug at `at`. */
function meter(watts: number, at: number) {
  const reading = {
    attributes: {}, entity_id: "sensor.washing_machine_power",
    last_reported: new Date(at).toISOString(), last_updated: new Date(at).toISOString(), state: String(watts),
  } as unknown as HaState;
  return new Map([[reading.entity_id, reading]]);
}

/** One meter tick, as the running app performs it. */
export async function tick(washing: typeof import("./washing"), data: string, at: number, watts: number) {
  const next = await washing.recordWashingMachineTick(readWash(data), meter(watts, at), new Date(at), 30 / 3600, 0.3);
  writeFileSync(washFile(data), JSON.stringify(next), "utf8");
  return next!;
}
