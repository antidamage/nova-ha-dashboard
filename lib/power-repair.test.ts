import { describe, expect, it } from "vitest";
import type { WashingMachineConfig } from "./config-schema";
import { blankCategoryState, blankFloatingMeterState, type FloatingMeterState } from "./power-floating-meter";
import { meterHistoryPoints, newRebuiltWashes, reattributeFloatingBuckets, replayWashingHistory } from "./power-repair";
import { blankWashingMachineState, recordWashingMachineSample } from "./washing-machine";

// Hour keys are treated as UTC here; the live caller resolves power.timeZone.
const hourStartMs = (hourKey: string) => Date.parse(`${hourKey}:00:00Z`);

function floating(): FloatingMeterState {
  const state = blankFloatingMeterState();
  state.categories.computers = {
    ...blankCategoryState(),
    hourly: {
      "2026-09-14T22": { seconds: 3600, wattSeconds: 3600 * 100 },
      "2026-09-14T23": { seconds: 1800, wattSeconds: 1800 * 200 },
      "2026-09-15T00": { seconds: 3600, wattSeconds: 3600 * 300 },
    },
    kwhTotal: 0.1 + 0.1 + 0.3,
    measuredSeconds: 9000,
  };
  state.categories.home_entertainment = {
    ...blankCategoryState(),
    hourly: { "2026-09-14T23": { seconds: 600, wattSeconds: 600 * 50 } },
    kwhTotal: (600 * 50) / 3_600_000,
    measuredSeconds: 600,
  };
  return state;
}

describe("reattributeFloatingBuckets", () => {
  const options = {
    fromCategoryId: "computers",
    hourStartMs,
    toCategoryId: "home_entertainment",
    untilMs: Date.parse("2026-09-15T00:17:29Z"),
  };

  it("moves buckets starting before until, including the partial hour, merging and moving totals", () => {
    const { moved, state } = reattributeFloatingBuckets(floating(), options);
    expect(moved).toEqual(["2026-09-14T22", "2026-09-14T23", "2026-09-15T00"]);
    expect(state.categories.computers.hourly).toEqual({});
    expect(state.categories.computers.measuredSeconds).toBe(0);
    expect(state.categories.computers.kwhTotal).toBeCloseTo(0);
    expect(state.categories.home_entertainment.hourly["2026-09-15T00"]).toEqual({ seconds: 3600, wattSeconds: 3600 * 300 });
    expect(state.categories.home_entertainment.hourly["2026-09-14T23"]).toEqual({
      seconds: 2400,
      wattSeconds: 1800 * 200 + 600 * 50,
    });
    expect(state.categories.home_entertainment.measuredSeconds).toBe(9600);
    expect(state.categories.home_entertainment.kwhTotal).toBeCloseTo(0.5 + (600 * 50) / 3_600_000);
  });

  it("leaves an hour starting exactly at until on the source", () => {
    const { moved } = reattributeFloatingBuckets(floating(), { ...options, untilMs: Date.parse("2026-09-15T00:00:00Z") });
    expect(moved).toEqual(["2026-09-14T22", "2026-09-14T23"]);
  });

  it("is idempotent", () => {
    const once = reattributeFloatingBuckets(floating(), options).state;
    const twice = reattributeFloatingBuckets(once, options);
    expect(twice.moved).toEqual([]);
    expect(twice.state).toEqual(once);
  });

  it("does nothing for a missing source or the same category", () => {
    expect(reattributeFloatingBuckets(floating(), { ...options, fromCategoryId: "kitchen" }).moved).toEqual([]);
    expect(reattributeFloatingBuckets(floating(), { ...options, toCategoryId: "computers" }).moved).toEqual([]);
  });
});

const CONFIG: WashingMachineConfig = {
  powerSensorEntityId: "sensor.local_power",
  fallbackPowerSensorEntityId: "sensor.cloud_power",
  entityIds: ["switch.washing_machine"],
  startWatts: 15,
  startSustainedSeconds: 120,
  endWatts: 5,
  endQuietSeconds: 300,
  typicalMinutes: 66,
  minCycleKwh: 0.02,
  completionAlert: {
    enabled: true,
    personId: "addie",
    soundFile: "done.mp3",
    zeroWatts: 0,
    quietSeconds: 60,
    maxSampleGapSeconds: 90,
    discord: true,
    drying: { hours: 4, daylightHours: 3, maxRainMm: 0.1, maxRainChancePct: 30 },
  },
  autoAttribution: {
    enabled: true,
    personId: "addie",
    standardMinMinutes: 1,
    standardMaxMinutes: 500,
    minDaysSinceLast: 0,
    consecutiveMaxGapMinutes: 60,
    spinMaxMinutes: 15,
    spinMaxGapMinutes: 30,
  },
};

const T0 = Date.parse("2026-09-14T20:00:00Z");
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** Report-on-change history: a 30-minute wash near 100 W reported every 45 s. */
function history() {
  const rows: Array<{ entity_id?: string; last_changed: string; state: string }> = [
    { entity_id: "sensor.cloud_power", last_changed: iso(0), state: "0" },
  ];
  for (let second = 6 * 60; second < 36 * 60; second += 45) {
    rows.push({ last_changed: new Date(T0 + second * 1000).toISOString(), state: String(90 + (second % 30)) });
  }
  rows.push({ last_changed: iso(36), state: "0" });
  return [rows];
}

function replay() {
  return replayWashingHistory({
    config: CONFIG,
    costPerKwhAt: () => 0.3,
    fromMs: T0,
    maxIntegrationHours: 2,
    points: meterHistoryPoints(history(), ["sensor.local_power", "sensor.cloud_power"]),
    tickSeconds: 10,
    toMs: T0 + 3 * 3_600_000,
  });
}

describe("washing-machine rebuild", () => {
  it("prefers the first entity and falls back while it is unavailable", () => {
    const points = meterHistoryPoints(
      [
        [{ entity_id: "sensor.local", last_changed: iso(0), state: "unavailable" }, { last_changed: iso(2), state: "7" }],
        [{ entity_id: "sensor.cloud", last_changed: iso(0), state: "3" }],
      ],
      ["sensor.local", "sensor.cloud"],
    );
    expect(points.map((point) => point.watts)).toEqual([3, 7]);
  });

  it("replays history into one cycle with a trace, and no alert or guess", () => {
    const rebuilt = replay();
    expect(rebuilt).toHaveLength(1);
    const [{ cycle, points }] = rebuilt;
    expect(cycle.startedAt).toBe(iso(6));
    expect(cycle.endedAt).toBe(iso(36));
    expect(cycle.kwh).toBeGreaterThan(0.04);
    expect(cycle.person).toBeNull();
    expect(cycle.attribution).toBeUndefined();
    expect(cycle.completion).toBeUndefined();
    expect(points[0][0]).toBe(0);
    expect(points.length).toBeGreaterThan(150);
  });

  it("inserts only washes not already stored, and is idempotent", () => {
    const now = T0 + 4 * 3_600_000;
    const first = newRebuiltWashes(blankWashingMachineState(), replay(), now);
    expect(first).toHaveLength(1);
    const stored = { ...blankWashingMachineState(), cycles: [{ ...first[0].cycle, person: "tonya" }] };
    expect(newRebuiltWashes(stored, replay(), now)).toEqual([]);
    expect(stored.cycles[0].person).toBe("tonya");
  });

  it("skips a rebuilt wash that overlaps a stored cycle with different bounds", () => {
    const stored = {
      ...blankWashingMachineState(),
      cycles: [{ id: "x", startedAt: iso(20), endedAt: iso(50), kwh: 0.1, costNzd: 0, person: "addie" }],
    };
    expect(newRebuiltWashes(stored, replay(), T0 + 4 * 3_600_000)).toEqual([]);
  });
});

describe("meter tick cadence", () => {
  it("detects, completes and closes a wash sampled every 10 s", () => {
    let state = blankWashingMachineState();
    let at = T0;
    const tick = (watts: number, seconds: number) => {
      for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
        at += 10_000;
        const now = new Date(at).toISOString();
        state = recordWashingMachineSample(state, {
          at: now, config: CONFIG, costPerKwh: 0.3, elapsedHours: 10 / 3600, reportedAt: now, watts,
        });
      }
    };
    tick(100, 30 * 60);
    tick(0, 6 * 60);
    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0].completion).toBeDefined();
    expect(state.cycles[0].kwh).toBeCloseTo(0.05, 2);
  });

  it("takes energy from the counter delta instead of held power", () => {
    let state = blankWashingMachineState();
    let at = T0;
    for (let index = 0; index < 400; index += 1) {
      at += 10_000;
      state = recordWashingMachineSample(state, {
        at: new Date(at).toISOString(),
        config: { ...CONFIG, completionAlert: undefined },
        costPerKwh: 0.3,
        elapsedHours: 10 / 3600,
        // 1 Wh per tick while running: ten times what 100 W held would give.
        energyKwh: index < 300 ? 0.001 : 0,
        watts: index < 300 ? 100 : 0,
      });
    }
    expect(state.cycles).toHaveLength(1);
    // The first powered tick only opens the rise; every later powered tick counts.
    expect(state.cycles[0].kwh).toBeCloseTo(0.299, 5);
  });
});
