import { describe, expect, it } from "vitest";
import {
  blankWashingMachineState,
  monthTotals,
  pruneWashingMachineCycles,
} from "../washing-machine";
import { replay } from "./washing-machine.fixtures";

describe("washing-machine cycle detection", () => {
  it("detects one cycle from a whole wash", () => {
    const state = replay([
      [1, 10],
      [400, 45],
      [1, 20],
    ]);

    expect(state.cycles).toHaveLength(1);
    expect(state.open).toBeNull();
    // 400W for 45 minutes is 0.3 kWh.
    expect(state.cycles[0].kwh).toBeCloseTo(0.3, 2);
    expect(state.cycles[0].costNzd).toBeCloseTo(0.09, 2);
    expect(state.cycles[0].person).toBeNull();
  });

  it("times the cycle from the rise, not from the confirmation", () => {
    const state = replay([
      [1, 10],
      [400, 45],
      [1, 20],
    ]);

    // The run begins one sample after the 10 idle minutes.
    expect(state.cycles[0].startedAt).toBe("2026-09-14T08:10:30.000Z");
    // It ends when power dropped, not when the quiet window expired.
    expect(state.cycles[0].endedAt).toBe("2026-09-14T08:55:30.000Z");
  });

  it("ignores a short standby blip", () => {
    // A one-minute rise never reaches startSustainedSeconds, so no cycle opens.
    const state = replay([
      [1, 10],
      [400, 1],
      [1, 20],
    ]);

    expect(state.cycles).toEqual([]);
  });

  it("discards a confirmed run that used too little energy", () => {
    // Above the start threshold for long enough, but 16W for 5 minutes is only
    // 0.0013 kWh — a door-open blip, not a wash.
    const state = replay([
      [1, 10],
      [16, 5],
      [1, 20],
    ]);

    expect(state.cycles).toEqual([]);
  });

  it("does not split a wash across a mid-cycle pause", () => {
    // A four-minute soak below the end threshold is shorter than the
    // five-minute quiet window, so the cycle stays open.
    const state = replay([
      [1, 10],
      [400, 20],
      [1, 4],
      [400, 20],
      [1, 20],
    ]);

    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0].kwh).toBeCloseTo(0.267, 2);
  });

  it("keeps a cycle open while the wash is still running", () => {
    const state = replay([
      [1, 10],
      [400, 20],
    ]);

    expect(state.cycles).toEqual([]);
    expect(state.open?.startedAt).toBe("2026-09-14T08:10:30.000Z");
  });

  it("does not integrate standby draw between washes", () => {
    const state = replay([[2, 60]]);

    expect(state.cycles).toEqual([]);
    expect(state.open?.kwh ?? 0).toBe(0);
  });
});

describe("month bucketing and totals", () => {
  const localMonth = (iso: string) => iso.slice(0, 7);
  const cycles = [
    { costNzd: 0.09, endedAt: "2026-08-31T23:00:00Z", id: "a", kwh: 0.3, person: "addie", startedAt: "2026-08-31T22:00:00Z" },
    { costNzd: 0.12, endedAt: "2026-09-02T10:00:00Z", id: "b", kwh: 0.4, person: "addie", startedAt: "2026-09-02T09:00:00Z" },
    { costNzd: 0.15, endedAt: "2026-09-09T10:00:00Z", id: "c", kwh: 0.5, person: "tonya", startedAt: "2026-09-09T09:00:00Z" },
    { costNzd: 0.06, endedAt: "2026-09-11T10:00:00Z", id: "d", kwh: 0.2, person: null, startedAt: "2026-09-11T09:00:00Z" },
  ];

  it("counts only the cycles that ended in the month", () => {
    const inMonth = cycles.filter((cycle) => localMonth(cycle.endedAt) === "2026-09");

    expect(inMonth.map((cycle) => cycle.id)).toEqual(["b", "c", "d"]);
  });

  it("totals per person plus unassigned", () => {
    const totals = monthTotals(
      cycles.filter((cycle) => localMonth(cycle.endedAt) === "2026-09"),
      ["addie", "tonya"],
    );

    expect(totals).toEqual([
      { costNzd: 0.12, cycles: 1, kwh: 0.4, person: "addie" },
      { costNzd: 0.15, cycles: 1, kwh: 0.5, person: "tonya" },
      { costNzd: 0.06, cycles: 1, kwh: 0.2, person: null },
    ]);
  });

  it("counts a cycle attributed to a departed person as unassigned", () => {
    const totals = monthTotals([cycles[2]], ["addie"]);

    expect(totals).toEqual([
      { costNzd: 0, cycles: 0, kwh: 0, person: "addie" },
      { costNzd: 0.15, cycles: 1, kwh: 0.5, person: null },
    ]);
  });

  it("prunes cycles past the retention window", () => {
    const state = { ...blankWashingMachineState(), cycles };

    expect(pruneWashingMachineCycles(state, "2026-09-01T00:00:00Z").cycles.map((c) => c.id)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});
