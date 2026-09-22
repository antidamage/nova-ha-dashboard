import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WashingMachineOpenCycle, WashingMachineState } from "../washing-machine";

/**
 * The wash's notification is an ordinary household timer
 * (specs/power-meters.md, "The wash's timer"): claiming the wash sets the one
 * household timer for what is left of the primary person's typical wash, and
 * everything that sounds or flashes afterwards is the timer's own. These cases
 * drive the whole claim path, not just the helper, because the timer has to be
 * set by the tap the household actually makes.
 */

const NOW = Date.parse("2026-09-22T02:00:00.000Z");
const TYPICAL_MINUTES = 66;

/** The household's own timer icon list, first entry first — Adeline's "Wash clothes". */
const HOUSEHOLD = {
  dashboard: { people: [
    { color: "#22d3ee", id: "addie", label: "Addie", primary: true },
    { color: "#e879f9", id: "tonya", label: "Tonya" },
  ] },
  power: {
    timeZone: "Pacific/Auckland",
    washingMachine: {
      entityIds: ["switch.washing_machine"],
      powerSensorEntityId: "sensor.washing_machine_power",
      typicalMinutes: TYPICAL_MINUTES,
    },
  },
};

const scratchDirs: string[] = [];

function scratch({ household = HOUSEHOLD, timerIcons = [{ glyph: { id: "tshirt", kind: "phosphor" }, id: "timer", label: "Wash clothes" }] as unknown, runningTimer = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "nova-wash-timer-"));
  scratchDirs.push(dir);
  const data = path.join(dir, "power");
  mkdirSync(path.join(data, "washing-machine-traces"), { recursive: true });
  const config = path.join(dir, "dashboard-config.json");
  writeFileSync(config, JSON.stringify(household), "utf8");
  const preferences = path.join(dir, "dashboard-preferences.json");
  writeFileSync(preferences, JSON.stringify(timerIcons === null ? {} : { orbInfo: { timerIcons } }), "utf8");
  const timerFile = path.join(dir, "orb-timer.json");
  if (runningTimer) {
    writeFileSync(timerFile, JSON.stringify({ notified: false, soundSlot: -1, timer: {
      completedAt: null, dismissedAt: null, durationMs: 1_800_000, endsAt: NOW + 1_200_000,
      icon: "fork-knife", id: "oven", label: "Check oven", startedAt: NOW,
    } }), "utf8");
  }
  return { config, data, preferences, timerFile };
}

/** An open wash that began `minutes)` ago, claimed by nobody yet. */
function openWash(minutes: number, person: string | null = null): WashingMachineState {
  const open: WashingMachineOpenCycle = {
    aboveSince: null, belowSince: null, costNzd: 0, kwh: 0.2, lastSampleAt: new Date(NOW).toISOString(),
    lastWatts: 220, person, startedAt: new Date(NOW - minutes * 60_000).toISOString(),
  };
  return { cycles: [], open, version: 1 };
}

function seed(data: string, state: WashingMachineState) {
  writeFileSync(path.join(data, "washing-machine.json"), JSON.stringify(state), "utf8");
}

async function fresh(configPath: string, data: string, preferences: string, timerFile: string) {
  vi.resetModules();
  vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", configPath);
  vi.stubEnv("NOVA_DASHBOARD_POWER_DATA", data);
  vi.stubEnv("NOVA_DASHBOARD_PREFERENCES", preferences);
  vi.stubEnv("NOVA_ORB_TIMER_FILE", timerFile);
  const [washing, eta] = await Promise.all([import("./washing"), import("./wash-eta-timer")]);
  return { eta, washing };
}

const readTimer = (file: string) => JSON.parse(readFileSync(file, "utf8")).timer as
  { durationMs: number; endsAt: number; icon: string; label: string } | null;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (scratchDirs.length) {
    rmSync(scratchDirs.pop()!, { force: true, recursive: true });
  }
});

describe("the wash's timer", () => {
  it("is started by the tap that claims the wash, for what is left of her typical wash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { config, data, preferences, timerFile } = scratch();
    seed(data, openWash(20));
    const { washing } = await fresh(config, data, preferences, timerFile);

    await washing.attributeOpenWashingMachineCycle();

    const timer = readTimer(timerFile);
    // 66 minutes typical, 20 already run.
    expect(timer?.durationMs).toBe(46 * 60_000);
    expect(timer?.endsAt).toBe(NOW + 46 * 60_000);
    // The household's own first timer icon: their glyph, their label.
    expect(timer?.icon).toBe("tshirt");
    expect(timer?.label).toBe("Wash clothes");
    vi.useRealTimers();
  });

  it("is not started when someone else's tap claims the wash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    seed(data, openWash(20, "tonya"));
    const { washing } = await fresh(config, data, preferences, timerFile);

    // Tonya -> nobody: the tap is a claim, just not the primary person's.
    await washing.attributeOpenWashingMachineCycle();

    expect(readTimer(timerFile)?.label).toBe("Check oven");
    vi.useRealTimers();
  });

  it("is not started once the wash has already run past its typical length", async () => {
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    seed(data, openWash(70, "addie"));
    const { eta } = await fresh(config, data, preferences, timerFile);

    expect(await eta.startWashEtaTimer(openWash(70, "addie").open!, new Date(NOW))).toBeNull();
    // A timer somebody else started is left exactly as it was.
    expect(readTimer(timerFile)?.label).toBe("Check oven");
  });

  it("is not started for a wash whose completion has already been captured", async () => {
    // The window between the completion edge and the cycle closing: the finished
    // wash is still on screen and still tappable, and a countdown for it must not
    // replace the timer the household is already running.
    const { config, data, preferences, timerFile } = scratch({ runningTimer: true });
    const open = openWash(20, "addie").open!;
    const { eta } = await fresh(config, data, preferences, timerFile);

    expect(await eta.startWashEtaTimer({ ...open, completion: { at: new Date(NOW).toISOString(), discord: true, person: "addie" } }, new Date(NOW))).toBeNull();
    expect(readTimer(timerFile)?.label).toBe("Check oven");
  });

  it("falls back to the default icon when the household has configured none", async () => {
    const { config, data, preferences, timerFile } = scratch({ timerIcons: null });
    seed(data, openWash(10, "addie"));
    const { eta } = await fresh(config, data, preferences, timerFile);

    await eta.startWashEtaTimer(openWash(10, "addie").open!, new Date(NOW));

    expect(readTimer(timerFile)?.icon).toBe("timer");
    expect(readTimer(timerFile)?.label).toBe("Countdown");
  });
});
