import { describe, expect, it } from "vitest";
import {
  beginWashTimer,
  blankWashingMachineState,
  monthTotals,
  pruneWashingMachineCycles,
  type WashingMachineState,
} from "../washing-machine";
import { CONFIG, REPLAY_START_MS, replay } from "./washing-machine.fixtures";

const MINUTE = 60_000;

/** A wash already under way, claimed by Addie, with her timer started. */
function claimed(): WashingMachineState {
  const startedAt = new Date(REPLAY_START_MS).toISOString();
  return {
    cycles: [],
    open: {
      aboveSince: startedAt, attribution: { at: startedAt, source: "manual" }, belowSince: null, costNzd: 0,
      kwh: 0.2, lastSampleAt: startedAt, lastWatts: 300, person: "addie", startedAt,
      timer: beginWashTimer(startedAt, CONFIG.timer),
    },
    version: 1,
  };
}

const ALERT = { discord: true, drying: { daylightHours: 3, hours: 4, maxRainMm: 0.1, maxRainChancePct: 30 }, enabled: true, personId: "addie" };

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

describe("the wash's timer while the cycle runs", () => {
  it("extends while the machine keeps drawing, then finishes on a quiet tail", () => {
    // 80 minutes of washing takes the first 70-minute period and one extension;
    // the quiet tail finishes it well before the five-minute close window.
    const state = replay([[300, 80], [0, 3]], claimed());

    expect(state.open?.timer?.extensions).toBe(2);
    expect(state.open?.timer?.completedAt).not.toBeNull();
    expect(state.cycles).toEqual([]);
  });

  it("finishes the timer on the machine's own quiet, not the alert's", () => {
    // No completion alert is configured at all, and the timer still finishes:
    // it is the wash's notification, not the reminder pipeline's.
    const state = replay([[300, 20], [0, 3]], claimed());

    expect(state.open?.timer?.extensions).toBe(0);
    expect(state.open?.timer?.completedAt).not.toBeNull();
    expect(state.open?.completion).toBeUndefined();
  });

  it("does not finish a timer for a machine that is still drawing", () => {
    const state = replay([[300, 20]], claimed());

    expect(state.open?.timer?.completedAt).toBeNull();
    expect(state.open?.timer?.extensions).toBe(0);
  });
});

describe("an unclaimed wash", () => {
  const WASH = [[1, 10], [400, 45], [1, 20]] as Array<[number, number]>;
  const CONFIGURED = { ...CONFIG, completionAlert: ALERT, unclaimedPersonId: "tonya" };

  it("closes as the household's other person, announced to nobody", () => {
    const state = replay(WASH, blankWashingMachineState(), CONFIGURED);

    expect(state.cycles[0].person).toBe("tonya");
    expect(state.cycles[0].attribution).toEqual({ at: expect.any(String), source: "auto" });
    // The completion names whoever owned the wash at that edge — nobody — and is
    // not the alert person's, so nothing goes out.
    expect(state.cycles[0].completion?.person).toBeNull();
    expect(state.cycles[0].completion?.discord).toBe(false);
  });

  it("is left alone while it is still running, pause and all", () => {
    // A soak longer than the stop window fires the completion edge — and the
    // machine then carries on, so the wash is still nobody's to reassign. Only
    // the close applies the household's default (specs/power-meters.md 4.3).
    const midWash = replay([[1, 10], [400, 45], [0, 3]], blankWashingMachineState(), CONFIGURED);

    expect(midWash.open?.completion).not.toBeUndefined();
    expect(midWash.open?.person).toBeUndefined();
    expect(midWash.open?.attribution).toBeUndefined();
    expect(midWash.cycles).toEqual([]);

    const closed = replay([[400, 5], [1, 10]], midWash, CONFIGURED);

    expect(closed.cycles).toHaveLength(1);
    expect(closed.cycles[0].person).toBe("tonya");
    expect(closed.cycles[0].attribution?.source).toBe("auto");
  });

  it("stays unassigned when the household names nobody", () => {
    const state = replay(WASH, blankWashingMachineState(), { ...CONFIG, completionAlert: ALERT });

    expect(state.cycles[0].person).toBeNull();
  });

  it("is still nobody's while it runs, with no default configured either", () => {
    const midWash = replay([[1, 10], [400, 45], [0, 3]], blankWashingMachineState(), { ...CONFIG, completionAlert: ALERT });

    expect(midWash.open?.person).toBeUndefined();
  });
});

describe("a claimed wash", () => {
  it("keeps its claimer past the close, and the unclaimed person is never applied", () => {
    const state = replay([[300, 20], [1, 10]], claimed(), { ...CONFIG, unclaimedPersonId: "tonya" });

    expect(state.cycles[0].person).toBe("addie");
    expect(state.cycles[0].attribution).toEqual({ at: expect.any(String), source: "manual" });
  });

  it("records a completion as hers and announces it", () => {
    const state = replay([[300, 20], [0, 6]], claimed(), { ...CONFIG, completionAlert: ALERT });

    expect(state.cycles[0].completion?.person).toBe("addie");
    expect(state.cycles[0].completion?.discord).toBe(true);
    // The wash's timer finished at the same edge as the completion, which is
    // after the drop it is timed from and before the cycle closes.
    expect(Date.parse(state.cycles[0].completion!.at)).toBeGreaterThan(Date.parse(state.cycles[0].endedAt));
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
