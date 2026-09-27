import { writeFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HouseholdPerson } from "../config-schema";
import type { WashingMachineCycle, WashingMachineState } from "../washing-machine";
import { buildWashDetail, wattsAxis } from "./wash-detail";
import type { WashTemperature } from "./wash-temperature";
import {
  cleanupWashStores,
  CONFIG,
  MORNING,
  scratch,
  seedOpenTrace,
  seedTrace,
  seedWashes,
} from "./wash-store.fixtures";

/**
 * One wash's own sheet (specs/power-meters.md §5.3).
 *
 * The page is a document, so what is worth pinning is what a reader of one wash's
 * page would check: that the figures are the run's own, that the peak is the peak
 * *and* where it was, that the average is the energy spread over the run rather
 * than the mean of the samples, and above all that **every stored sample survives
 * into the graph** — the panel's 48 points are its block, not this sheet.
 *
 * `Pacific/Auckland` is UTC+12 through these fixtures, so a local 9:10 AM wash is
 * 21:10Z the day before.
 */

const PEOPLE: HouseholdPerson[] = [
  { arrival: [], color: "#22d3ee", departure: [], id: "addie", label: "Addie", primary: true },
];

const RATE = {
  asOf: "2026-09-27",
  cPerKwh: 28.279,
  includingGst: true,
  planName: "Contact Energy Basic",
  sourceUrl: "",
  windows: [],
};

/** 9:10-10:20 AM local on 19 September: 70 minutes, 0.62 kWh, $0.43, hers. */
const WASH: WashingMachineCycle = {
  costNzd: 0.43,
  endedAt: "2026-09-18T22:20:00.000Z",
  id: "2026-09-18T21-10-00-000Z",
  kwh: 0.62,
  person: "addie",
  startedAt: "2026-09-18T21:10:00.000Z",
};

/** What the classifier read off this wash's samples; the sheet carries its answer (§5.3). */
const TEMPERATURE: WashTemperature = {
  degrees: 40,
  heatUp: { open: false, seconds: 487, watts: 2190 },
  source: "degrees",
};

const detail = (points: Array<[number, number]>, cycle: WashingMachineCycle = WASH) =>
  buildWashDetail({ cycle, people: PEOPLE, points, rate: RATE, running: false, temperature: TEMPERATURE });

describe("one wash's own sheet", () => {
  it("labels the run in the household's own timezone", () => {
    const view = detail([[0, 12], [4200, 8]]);

    expect(view.dateLabel).toBe("Sat 19 Sep 2026");
    expect(view.startLabel).toBe("9:10 AM");
    expect(view.endLabel).toBe("10:20 AM");
    expect(view.durationLabel).toBe("1h 10m");
    expect(view.durationSeconds).toBe(4200);
  });

  it("carries every stored sample, at the resolution the meter kept them", () => {
    // The property the sheet exists for: no downsampling. A wash's trace is one
    // point per meter sample, and the graph draws all of them (§5.3).
    const points: Array<[number, number]> = Array.from({ length: 400 }, (_, index) => [index * 10, 300 + index]);

    const view = detail(points);

    expect(view.samples).toBe(400);
    expect(view.points).toHaveLength(400);
    expect(view.points.at(-1)).toEqual([3990, 699]);
  });

  it("states the peak and where in the run it was", () => {
    const view = detail([[0, 12], [600, 2100], [1200, 340], [4200, 5]]);

    expect(view.peakWatts).toBe(2100);
    expect(view.peakAtSeconds).toBe(600);
  });

  it("averages the energy over the run, not the samples", () => {
    // 0.62 kWh in 70 minutes is 531.4 W, and that is the draw the machine ran at —
    // a spike at the end of a wash must not move it.
    expect(detail([[0, 1], [4200, 1]]).averageWatts).toBe(531);
  });

  it("states the unit cost the wash actually drew at", () => {
    // $0.43 for 0.62 kWh is 69.35c/kWh: the rate in force while it ran (§4.1).
    expect(detail([[0, 100]]).cPerKwh).toBeCloseTo(69.3548, 3);
    // A wash that drew nothing has no unit cost rather than a division by zero.
    expect(buildWashDetail({
      cycle: { ...WASH, costNzd: 0, kwh: 0 },
      people: PEOPLE,
      points: [],
      rate: RATE,
      running: false,
      temperature: TEMPERATURE,
    }).cPerKwh).toBeNull();
  });

  it("counts the wash in the month it ended in, which is the bucket the totals use", () => {
    // 11:50 PM on 31 August local, finishing after midnight: September's bill (§5.3).
    const across = { ...WASH, endedAt: "2026-08-31T12:40:00.000Z", startedAt: "2026-08-31T11:50:00.000Z" };

    expect(detail([[0, 12]], across).monthKey).toBe("2026-09");
  });

  it("carries the temperature its samples were read for", () => {
    expect(detail([[0, 12], [4200, 8]]).temperature.degrees).toBe(40);
  });

  it("says a wash with no samples plainly rather than inventing a curve", () => {
    const view = detail([]);

    expect(view.samples).toBe(0);
    expect(view.peakWatts).toBe(0);
    expect(view.peakAtSeconds).toBe(0);
  });
});

describe("the watts axis", () => {
  it("tops out on a readable step above the peak", () => {
    expect(wattsAxis(2100)).toEqual({ step: 1000, top: 3000 });
    expect(wattsAxis(310)).toEqual({ step: 200, top: 600 });
    expect(wattsAxis(4)).toEqual({ step: 25, top: 75 });
  });

  it("gives the tallest step it has to a wash that draws more than it knows about", () => {
    // 7.4 kW is beyond a household circuit: the axis still has to label itself.
    expect(wattsAxis(7400).top).toBeGreaterThanOrEqual(7400);
  });
});

// ---------------------------------------------------------------------------
// The same sheet, read from the store: where its samples come from, and what it
// says about a wash the store no longer holds (specs/power-meters.md §5.3).
//
// File-backed, so every case here imports the power module graph afresh against
// its own stubbed environment — seconds of real work on a loaded box, which is
// why this file's budget is raised.
// ---------------------------------------------------------------------------
vi.setConfig({ testTimeout: 30_000 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  cleanupWashStores();
});

/** The same household with the machine's own plan on it, which is what a wash is costed at (§4.1). */
const DETAIL_CONFIG = {
  ...CONFIG,
  power: {
    ...CONFIG.power,
    washingMachine: {
      ...CONFIG.power.washingMachine,
      rates: { cPerKwh: 28.279, planName: "Contact Energy Basic", windows: [] },
    },
  },
};

/** One scratch store, and the module graph imported fresh against it. */
async function freshDetail(state: WashingMachineState, seed?: (data: string) => void, config: unknown = DETAIL_CONFIG) {
  const { config: configPath, data } = scratch();
  writeFileSync(configPath, JSON.stringify(config), "utf8");
  seedWashes(data, state);
  seed?.(data);
  vi.resetModules();
  vi.stubEnv("NOVA_DASHBOARD_HOUSEHOLD_CONFIG", configPath);
  vi.stubEnv("NOVA_DASHBOARD_POWER_DATA", data);
  return await import("./wash-history");
}

describe("reading one wash's own sheet from the store", () => {
  it("reads the wash's own trace at the resolution the meter wrote it", async () => {
    const module = await freshDetail(
      { cycles: [MORNING], open: null, version: 1 },
      (data) => seedTrace(data, MORNING, [12.4, 380, 210.5]),
    );

    const detail = await module.readWashDetail(MORNING.id);

    expect(detail?.id).toBe(MORNING.id);
    expect(detail?.running).toBe(false);
    // Three samples in, three samples out: the sheet's graph is the trace itself,
    // not the panel's 48-point block (§5.3).
    expect(detail?.points).toEqual([[0, 12.4], [30, 380], [60, 210.5]]);
    expect(detail?.samples).toBe(3);
    expect(detail?.kwh).toBe(MORNING.kwh);
    expect(detail?.person).toBe("tonya");
    // The month it is filed under, which is the month the sheet's back-link opens.
    expect(detail?.monthKey).toBe("2026-09");
    expect(detail?.rate.planName).toBe("Contact Energy Basic");
  });

  it("names the wash under way by the id every view lists it under, from its open trace", async () => {
    const startedAt = "2026-09-19T22:30:00.000Z";
    const at = Date.parse(startedAt) / 1000;
    const module = await freshDetail(
      {
        cycles: [MORNING],
        open: {
          aboveSince: null, belowSince: null, costNzd: 0.09, kwh: 0.14,
          lastSampleAt: startedAt, lastWatts: 640, person: "addie", startedAt,
        },
        version: 1,
      },
      (data) => seedOpenTrace(data, startedAt, [[at, 610], [at + 45, 640]]),
    );

    const detail = await module.readWashDetail("running");

    expect(detail?.running).toBe(true);
    expect(detail?.person).toBe("addie");
    // The open trace carries absolute instants; the graph is measured from the
    // start, the way a closed wash's own file already is (§4.6).
    expect(detail?.points).toEqual([[0, 610], [45, 640]]);
    // And the same wash answers to the id its own start instant makes, so a link
    // that carried that id still opens it.
    expect((await module.readWashDetail("2026-09-19T22-30-00-000Z"))?.running).toBe(true);
  });

  it("says nothing for an id the store no longer holds", async () => {
    // A link older than the 400 days the store keeps, or one that was never a wash:
    // the page says so and sends the reader back to the bill (§5.3).
    const module = await freshDetail({ cycles: [MORNING], open: null, version: 1 });

    await expect(module.readWashDetail("2026-01-01T00-00-00-000Z")).resolves.toBeNull();
  });

  it("reads nothing when this dashboard has no washing machine at all", async () => {
    const module = await freshDetail(
      { cycles: [MORNING], open: null, version: 1 },
      undefined,
      { ...CONFIG, power: { timeZone: "Pacific/Auckland" } },
    );

    await expect(module.readWashDetail(MORNING.id)).resolves.toBeNull();
  });
});
