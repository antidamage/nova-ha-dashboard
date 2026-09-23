import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WashingMachineCycle, WashingMachineState } from "../washing-machine";
import { NOW, cleanUp, fresh, openWash, readWash, scratch, seed } from "./wash-timer.fixtures";

/**
 * What a tap on a wash block does (specs/power-meters.md 4.3): Unassigned ->
 * Addie -> Tonya -> Unassigned, following config order — except on a block the
 * household's *default* picked up. A default is not a claim, so a tap there
 * claims the wash for the first configured person in one step, which is what the
 * panel's optimistic value shows too. Anything else left a wash the default had
 * touched needing two taps to claim, and the first of them read as the claim
 * being released.
 */

vi.setConfig({ testTimeout: 30_000 });

const cycle = (person: string | null, source?: "auto" | "manual"): WashingMachineCycle => ({
  ...(source ? { attribution: { at: new Date(NOW).toISOString(), source } } : {}),
  costNzd: 0.1, endedAt: new Date(NOW).toISOString(), id: "wash-1", kwh: 0.2, person,
  startedAt: new Date(NOW - 60 * 60_000).toISOString(),
});

/** The household's other person is configured, so a default can exist at all. */
const HOUSEHOLD = {
  dashboard: { people: [
    { color: "#22d3ee", id: "addie", label: "Addie", primary: true },
    { color: "#e879f9", id: "tonya", label: "Tonya" },
  ] },
  power: { timeZone: "Pacific/Auckland", washingMachine: {
    entityIds: ["switch.washing_machine"], powerSensorEntityId: "sensor.washing_machine_power",
    timer: { extendMinutes: 10, firstPeriodMinutes: 70, maxSampleGapSeconds: 90, stopSeconds: 120, stopWatts: 5 },
    unclaimedPersonId: "tonya",
  } },
};

async function withStore(state: WashingMachineState) {
  const files = scratch({ household: HOUSEHOLD });
  seed(files.data, state);
  const { washing } = await fresh(files.config, files.data, files.preferences, files.timerFile);
  return { ...files, washing };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanUp();
});

describe("tapping a wash block", () => {
  it("claims an unclaimed wash for the first configured person", async () => {
    const { data, washing } = await withStore({ cycles: [cycle(null)], open: null, version: 1 });

    await washing.attributeWashingMachineCycle("wash-1");

    expect(readWash(data).cycles[0].person).toBe("addie");
    expect(readWash(data).cycles[0].attribution?.source).toBe("manual");
  });

  it("claims a wash the default picked up in one tap, not two", async () => {
    const { data, washing } = await withStore({ cycles: [cycle("tonya", "auto")], open: null, version: 1 });

    await washing.attributeWashingMachineCycle("wash-1");

    expect(readWash(data).cycles[0].person).toBe("addie");
  });

  it("still cycles onward from a wash someone claimed by hand", async () => {
    // A manual Tonya is a claim — hers — so the tap walks on to Unassigned
    // rather than taking the block for the primary person.
    const { data, washing } = await withStore({ cycles: [cycle("tonya", "manual")], open: null, version: 1 });

    await washing.attributeWashingMachineCycle("wash-1");

    expect(readWash(data).cycles[0].person).toBeNull();
  });

  it("claims the running wash in one tap when the default had picked it up", async () => {
    // The case that was irritating: the default fires on a pause while the
    // machine is still going, and the household's next tap has to take the wash
    // back off it.
    const open = { ...openWash(20, "tonya").open!, attribution: { at: new Date(NOW).toISOString(), source: "auto" as const } };
    const { data, washing } = await withStore({ cycles: [], open, version: 1 });

    await washing.attributeOpenWashingMachineCycle();

    expect(readWash(data).open?.person).toBe("addie");
    expect(readWash(data).open?.attribution?.source).toBe("manual");
  });
});
