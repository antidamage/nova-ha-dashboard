import { describe, expect, it } from "vitest";
import { recordWashingMachineSample, type WashingMachineState } from "./washing-machine";
import type { WashingMachineConfig } from "./config-schema";
import { dryingRecommendation } from "./wash-drying";

const at = Date.parse("2026-09-14T00:00:00Z");
const drying = { hours: 4, daylightHours: 3, maxRainMm: 0.1, maxRainChancePct: 30 };
const config: WashingMachineConfig = { powerSensorEntityId: "sensor.test", entityIds: ["switch.test"], startWatts: 15, startSustainedSeconds: 120, endWatts: 5, endQuietSeconds: 300, minCycleKwh: 0.05, typicalMinutes: 66,
  completionAlert: { enabled: true, personId: "owner", quietSeconds: 60, zeroWatts: 0, maxSampleGapSeconds: 90, discord: true, drying } };
function running(person: string | null = "owner", kwh = 0.2): WashingMachineState {
  return { version: 1, cycles: [], open: { person, kwh, costNzd: 0.1, startedAt: new Date(at - 600000).toISOString(), aboveSince: null, belowSince: null, lastSampleAt: new Date(at - 30000).toISOString(), lastWatts: 200 } };
}
function sample(state: WashingMachineState, seconds: number, watts = 0) {
  return recordWashingMachineSample(state, { config, at: new Date(at + seconds * 1000).toISOString(), watts, costPerKwh: 0.3, elapsedHours: 30 / 3600 });
}
describe("wash completion", () => {
  it("requires strictly more than a minute and preserves one occurrence through closure", () => {
    let state = sample(running(), 0);
    state = sample(state, 30); state = sample(state, 60);
    expect(state.open?.completion).toBeUndefined();
    state = sample(state, 90);
    const completion = state.open?.completion;
    expect(completion?.discord).toBe(true);
    for (let s = 120; s <= 300; s += 30) state = sample(state, s);
    expect(state.cycles[0].completion).toEqual(completion);
    expect(state.cycles[0].person).toBe("owner");
  });
  it("resets for a positive reading or a monitoring gap", () => {
    let state = sample(running(), 0); state = sample(state, 30, 2); state = sample(state, 60); state = sample(state, 90);
    expect(state.open?.completion).toBeUndefined();
    state = sample(state, 200);
    expect(state.open?.zeroSince).toBe(new Date(at + 200000).toISOString());
    expect(state.open?.completion).toBeUndefined();
  });
  it("does not promote standby energy into a completion", () => {
    let state = sample(running("owner", 0), 0);
    for (let s = 30; s <= 120; s += 30) state = sample(state, s);
    expect(state.open?.completion).toBeUndefined();
  });
  it("captures a completion from a report-on-change meter whose report time freezes at the drop", () => {
    // The live Tuya cloud bridge writes the entity only when its value changes,
    // so `last_reported` stays at the instant the machine dropped to zero and
    // never advances again. On 2026-09-22 a claimed wash (01:35:30Z-02:31:29Z)
    // was observed ending at 0 W every 10s and no alert ever fired, because the
    // quiet window was measured from the report time to the same report time.
    const tick = (state: WashingMachineState, seconds: number) => recordWashingMachineSample(state, {
      config, at: new Date(at + seconds * 1000).toISOString(), reportedAt: new Date(at).toISOString(),
      watts: 0, costPerKwh: 0.3, elapsedHours: 10 / 3600,
    });
    let state = running();
    for (let s = 0; s <= 60; s += 10) { state = tick(state, s); expect(state.open?.completion).toBeUndefined(); }
    state = tick(state, 70);
    expect(state.open?.completion?.person).toBe("owner");
  });
  it("does not backdate the quiet window onto a report that had already gone stale", () => {
    // An old cached zero is not evidence the machine finished just now: the
    // window starts with the sample that observed it, so a stale report can
    // never complete a wash on the first tick after a restart or a re-connect.
    const state = recordWashingMachineSample(running(), {
      config, at: new Date(at).toISOString(), reportedAt: new Date(at - 600_000).toISOString(),
      watts: 0, costPerKwh: 0.3, elapsedHours: 10 / 3600,
    });
    expect(state.open?.zeroSince).toBe(new Date(at).toISOString());
    expect(state.open?.completion).toBeUndefined();
  });
  it("captures ownership at the completion edge, including unclaimed washes", () => {
    let state = sample(running(null), 0);
    for (let s = 30; s <= 90; s += 30) state = sample(state, s);
    state.open!.person = "owner";
    state = sample(state, 120);
    expect(state.open?.completion?.person).toBeNull();
    expect(state.open?.completion?.discord).toBe(false);
  });
});
describe("drying recommendation", () => {
  const sun = { state: "above_horizon", nextSetting: new Date(at + 6 * 3600000).toISOString() };
  const rows = () => Array.from({ length: 4 }, (_, i) => ({ datetime: new Date(at + i * 3600000).toISOString(), precipitation: 0, precipitation_probability: 10, condition: "sunny" }));
  it("accepts a dry four-hour forecast", () => expect(dryingRecommendation(rows(), sun, at, "mm", drying)).toContain("Yes"));
  it("rejects wet weather, including inch units", () => {
    const forecast = rows(); forecast[2].precipitation = 0.01;
    expect(dryingRecommendation(forecast, sun, at, "in", drying)).toContain("No");
    forecast[2].precipitation = 0; forecast[2].precipitation_probability = 30;
    expect(dryingRecommendation(forecast, sun, at, "mm", drying)).toContain("No");
  });
  it("rejects missing coverage and missing rain amounts", () => {
    expect(dryingRecommendation(rows().slice(2), sun, at, "mm", drying)).toContain("can't confirm");
    expect(dryingRecommendation([{ datetime: new Date(at).toISOString() }], sun, at, "mm", drying)).toContain("can't confirm");
  });
  it("rejects darkness", () => expect(dryingRecommendation(rows(), { ...sun, state: "below_horizon" }, at, "mm", drying)).toContain("daylight"));
});
