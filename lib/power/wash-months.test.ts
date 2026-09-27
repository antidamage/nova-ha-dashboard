import { describe, expect, it } from "vitest";
import type { HouseholdPerson } from "../config-schema";
import type { WashingMachineCycle, WashingMachineState } from "../washing-machine";
import { buildWashMonth, washClaimColor, washMonthLabel, washMonths } from "./wash-months";

/**
 * The laundry page's month view (specs/power-meters.md §5.3).
 *
 * The page is a bill, so the things worth pinning are the ones a reader of a
 * bill would notice: which month it opens on, that its totals are the washes it
 * lists, and that a wash still running is listed but counted in nothing.
 *
 * Local times are `Pacific/Auckland`, UTC+12 through these fixtures, so a local
 * midnight is 12:00Z the day before.
 */

const PEOPLE: HouseholdPerson[] = [
  { arrival: [], color: "#22d3ee", departure: [], id: "addie", label: "Addie", primary: true },
  { arrival: [], color: "#e879f9", departure: [], id: "tonya", label: "Tonya" },
];

const RATE = { asOf: "2026-09-27", cPerKwh: 28.279, includingGst: true, planName: "Contact Energy Basic", sourceUrl: "", windows: [] };

/** 9:10-10:20 AM local on 19 September, hers. */
const SEPTEMBER: WashingMachineCycle = {
  costNzd: 0.43,
  endedAt: "2026-09-18T22:20:00.000Z",
  id: "2026-09-18T21-10-00-000Z",
  kwh: 0.62,
  person: "addie",
  startedAt: "2026-09-18T21:10:00.000Z",
};

/** 8:00-8:12 AM local on 24 August, hers. */
const AUGUST: WashingMachineCycle = {
  costNzd: 0.06,
  endedAt: "2026-08-23T20:12:00.000Z",
  id: "2026-08-23T20-00-00-000Z",
  kwh: 0.09,
  person: "addie",
  startedAt: "2026-08-23T20:00:00.000Z",
};

const state = (cycles: WashingMachineCycle[], open: WashingMachineState["open"] = null): WashingMachineState =>
  ({ cycles, open, version: 1 });

const view = (overrides: { cycles?: WashingMachineCycle[]; open?: WashingMachineState["open"]; requested?: string | null; now?: Date } = {}) =>
  buildWashMonth({
    now: overrides.now ?? new Date("2026-09-25T00:00:00.000Z"),
    people: PEOPLE,
    rate: RATE,
    requested: overrides.requested ?? null,
    state: state(overrides.cycles ?? [SEPTEMBER, AUGUST], overrides.open ?? null),
  });

describe("the months a page can step through", () => {
  it("lists the months holding a wash, newest first, with the month under way prepended", () => {
    // `now` is 25 September, which itself holds no wash: the month under way is
    // in the list so the page can say `$0.00`, and the month that does hold one
    // is the entry below it — "previous".
    expect(washMonths(state([SEPTEMBER, AUGUST]), new Date("2026-09-25T00:00:00.000Z")))
      .toEqual(["2026-09", "2026-08"]);
  });

  it("does not duplicate a month under way that already holds a wash", () => {
    expect(washMonths(state([SEPTEMBER, AUGUST]), new Date("2026-09-19T00:00:00.000Z")))
      .toEqual(["2026-09", "2026-08"]);
  });

  it("names a month the way a bill heads it", () => {
    expect(washMonthLabel("2026-09")).toBe("September 2026");
    expect(washMonthLabel("2026-01")).toBe("January 2026");
    expect(washMonthLabel("nonsense")).toBe("nonsense");
  });
});

describe("the month the page opens on", () => {
  it("opens on the month under way when it holds a wash", () => {
    const month = view();

    expect(month.label).toBe("September 2026");
    expect(month.nextMonthKey).toBeNull();
    expect(month.previousMonthKey).toBe("2026-08");
  });

  it("opens on the month under way even when it holds nothing, with the last month that did one press away", () => {
    // A bill opens on the current period. On the 2nd of a month the answer is
    // `$0.00`, not last month's total silently relabelled with this month's name.
    const month = view({ now: new Date("2026-10-02T00:00:00.000Z") });

    expect(month.label).toBe("October 2026");
    expect(month.washes).toBe(0);
    expect(month.costNzd).toBe(0);
    expect(month.previousMonthKey).toBe("2026-09");
    expect(month.nextMonthKey).toBeNull();
  });

  it("reads the month it was asked for, and its neighbours", () => {
    const month = view({ requested: "2026-08" });

    expect(month.label).toBe("August 2026");
    expect(month.nextMonthKey).toBe("2026-09");
    expect(month.previousMonthKey).toBeNull();
  });

  it("falls back to the opening month for a month it has nothing for", () => {
    expect(view({ requested: "2026-07" }).label).toBe("September 2026");
  });
});

describe("a month's washes, totals and claims", () => {
  it("lists only its own month's washes, oldest first, with their labels", () => {
    const month = view();

    expect(month.cycles.map((cycle) => cycle.id)).toEqual([SEPTEMBER.id]);
    expect(month.cycles[0].dateLabel).toBe("Sat 19 Sep");
    expect(month.cycles[0].startLabel).toBe("9:10 AM");
    expect(month.cycles[0].durationLabel).toBe("1h 10m");
  });

  it("totals the washes it lists, per person and with the unclaimed row", () => {
    const month = view();

    expect(month.kwh).toBeCloseTo(0.62, 5);
    expect(month.costNzd).toBeCloseTo(0.43, 5);
    expect(month.totals.map((row) => [row.person, row.cycles])).toEqual([["addie", 1], ["tonya", 0], [null, 0]]);
  });

  it("counts the month's washes itself, not the Unassigned bucket", () => {
    // The bug this pins: the page read `totals.find((row) => row.person === null)`
    // as the month's total, and that row is the Unassigned *bucket*. With one
    // claimed wash and one unclaimed, the bill's "All washes" line counted 1
    // while its energy and cost were the month's.
    const unclaimed: WashingMachineCycle = { ...SEPTEMBER, id: "2026-09-20T20-00-00-000Z", person: null };
    const month = view({ cycles: [SEPTEMBER, unclaimed] });

    expect(month.washes).toBe(2);
    expect(month.totals.find((row) => row.person === null)?.cycles).toBe(1);
  });

  it("counts a wash of somebody who has left config as unassigned", () => {
    const month = view({ cycles: [{ ...SEPTEMBER, person: "nobody" }] });

    expect(month.totals.find((row) => row.person === null)?.cycles).toBe(1);
  });

  it("lists the wash under way but counts it in nothing", () => {
    const month = view({
      cycles: [SEPTEMBER],
      open: {
        aboveSince: null, belowSince: null, costNzd: 0.12, kwh: 0.2, lastSampleAt: "2026-09-25T00:00:00.000Z",
        lastWatts: 220, person: null, startedAt: "2026-09-24T23:50:00.000Z",
      },
    });

    expect(month.running?.durationLabel).toBe("10m");
    expect(month.running?.person).toBeNull();
    expect(month.washes).toBe(1);
    expect(month.kwh).toBeCloseTo(0.62, 5);
    expect(month.costNzd).toBeCloseTo(0.43, 5);
    expect(month.totals.find((row) => row.person === null)?.cycles).toBe(0);
  });

  it("does not list a running wash in another month's page", () => {
    const month = view({
      requested: "2026-08",
      open: {
        aboveSince: null, belowSince: null, costNzd: 0.12, kwh: 0.2, lastSampleAt: "2026-09-25T00:00:00.000Z",
        lastWatts: 220, person: null, startedAt: "2026-09-24T23:50:00.000Z",
      },
    });

    expect(month.running).toBeNull();
  });

  it("states the plan its costs were struck at", () => {
    expect(view().rate.planName).toBe("Contact Energy Basic");
  });
});

describe("the colour a wash wears on the page", () => {
  it("is the claimer's, and nothing at all when nobody claimed it", () => {
    expect(washClaimColor("addie", PEOPLE)).toBe("#22d3ee");
    expect(washClaimColor("tonya", PEOPLE)).toBe("#e879f9");
    expect(washClaimColor(null, PEOPLE)).toBeUndefined();
  });

  it("is nothing for a person this household no longer configures", () => {
    // The field and the totals already read such a wash as Unassigned, so the
    // row's colour must not fall back to the first configured person's.
    expect(washClaimColor("someone-removed", PEOPLE)).toBeUndefined();
  });
});
