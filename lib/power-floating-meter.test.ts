import { describe, expect, it } from "vitest";
import {
  blankFloatingMeterState,
  categoryReading,
  pruneFloatingMeterState,
  recordFloatingSample,
  suppressedBaseLoadIds,
  type FloatingMeterState,
} from "./power-floating-meter";
import type { FloatingMeterCategory } from "./config-schema";

const KITCHEN: FloatingMeterCategory = {
  id: "kitchen",
  label: "Kitchen",
  icon: "kitchen",
  seedWatts: 100,
  suppressesBaseLoads: ["fridges"],
  members: ["Fridge 1", "Fridge 2", "Main WiFi AP"],
};

const OPTIONS = { activeWatts: null, hourOfDay: "13", minLearnedHours: 24, today: "2026-09-14" };

/** Fill `hours` whole hours of history at `watts`, ending on `endDate`. */
function withHistory(watts: number, hours: number, endDate = "2026-09-13"): FloatingMeterState {
  const state = blankFloatingMeterState();
  for (let index = 0; index < hours; index += 1) {
    const hour = String(index % 24).padStart(2, "0");
    const day = new Date(`${endDate}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - Math.floor(index / 24));
    const dateKey = day.toISOString().slice(0, 10);
    recordFloatingSample(state, "kitchen", watts, 3600, `${dateKey}T${hour}`, `${dateKey}T${hour}:00:00Z`);
  }
  return state;
}

describe("the floating meter fallback ladder", () => {
  it("reports the live reading while the meter is on the category", () => {
    const state = blankFloatingMeterState();
    state.activeCategoryId = "kitchen";

    const reading = categoryReading(KITCHEN, state, { ...OPTIONS, activeWatts: 143.2 });

    expect(reading).toMatchObject({ active: true, confidence: "measured", watts: 143.2 });
  });

  it("falls back to the configured seed with no history", () => {
    const reading = categoryReading(KITCHEN, blankFloatingMeterState(), OPTIONS);

    expect(reading).toMatchObject({ confidence: "assumed", watts: 100 });
  });

  it("still uses the seed below the minimum learned hours", () => {
    const reading = categoryReading(KITCHEN, withHistory(80, 5), OPTIONS);

    expect(reading).toMatchObject({ confidence: "assumed", watts: 100 });
  });

  it("uses the hour-of-day profile once enough has been measured", () => {
    const reading = categoryReading(KITCHEN, withHistory(80, 48), OPTIONS);

    expect(reading.confidence).toBe("high");
    expect(reading.watts).toBeCloseTo(80, 1);
    expect(reading.measuredHours).toBe(48);
  });

  it("falls back to a flat mean when this hour has never been observed", () => {
    const state = withHistory(80, 48);
    for (const key of Object.keys(state.categories.kitchen.hourly)) {
      if (key.endsWith("T13")) {
        delete state.categories.kitchen.hourly[key];
      }
    }

    const reading = categoryReading(KITCHEN, state, OPTIONS);

    expect(reading.confidence).toBe("medium");
    expect(reading.watts).toBeCloseTo(80, 1);
  });

  it("moves the estimate toward newer measurements", () => {
    // The same group measured at 80W a month ago and 200W yesterday reads
    // above the unweighted midpoint of 140W: the older evidence still counts,
    // but at roughly half the weight after one 28-day half-life.
    const state = withHistory(80, 48, "2026-08-14");
    const recent = withHistory(200, 48, "2026-09-13");
    for (const [key, bucket] of Object.entries(recent.categories.kitchen.hourly)) {
      state.categories.kitchen.hourly[key] = bucket;
      state.categories.kitchen.measuredSeconds += bucket.seconds;
    }

    const reading = categoryReading(KITCHEN, state, OPTIONS);

    expect(reading.confidence).toBe("high");
    expect(reading.watts).toBeGreaterThan(140);
    expect(reading.watts).toBeLessThanOrEqual(200);
  });
});

describe("floating meter accumulation", () => {
  it("accumulates watt-seconds, hours and kWh for the active category", () => {
    const state = blankFloatingMeterState();
    recordFloatingSample(state, "kitchen", 100, 1800, "2026-09-14T13", "2026-09-14T13:30:00Z");
    recordFloatingSample(state, "kitchen", 200, 1800, "2026-09-14T13", "2026-09-14T14:00:00Z");

    const category = state.categories.kitchen;
    expect(category.hourly["2026-09-14T13"]).toEqual({ seconds: 3600, wattSeconds: 540_000 });
    expect(category.measuredSeconds).toBe(3600);
    expect(category.kwhTotal).toBeCloseTo(0.15, 5);
    expect(category.lastWatts).toBe(200);
  });

  it("records a reading with no elapsed time without inventing history", () => {
    const state = blankFloatingMeterState();
    recordFloatingSample(state, "kitchen", 100, 0, "2026-09-14T13", "2026-09-14T13:00:00Z");

    expect(state.categories.kitchen.measuredSeconds).toBe(0);
    expect(state.categories.kitchen.hourly).toEqual({});
    expect(state.categories.kitchen.lastWatts).toBe(100);
  });

  it("prunes observations past the retention window", () => {
    const state = blankFloatingMeterState();
    recordFloatingSample(state, "kitchen", 100, 3600, "2026-05-01T13", "2026-05-01T13:00:00Z");
    recordFloatingSample(state, "kitchen", 100, 3600, "2026-09-14T13", "2026-09-14T13:00:00Z");

    pruneFloatingMeterState(state, "2026-06-16");

    expect(Object.keys(state.categories.kitchen.hourly)).toEqual(["2026-09-14T13"]);
  });
});

describe("base-load suppression", () => {
  it("collects the modelled loads the categories stand in for", () => {
    const readings = [
      { suppressesBaseLoads: ["fridges"] },
      { suppressesBaseLoads: ["nova_aio"] },
      { suppressesBaseLoads: [] },
    ] as Parameters<typeof suppressedBaseLoadIds>[0];

    expect([...suppressedBaseLoadIds(readings)].sort()).toEqual(["fridges", "nova_aio"]);
  });
});
