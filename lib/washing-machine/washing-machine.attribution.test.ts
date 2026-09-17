import { describe, expect, it } from "vitest";
import {
  autoAttributeCycle,
  blankWashingMachineState,
  downsampleTrace,
  settleAutoAttribution,
  type WashingMachineCycle,
  nextPerson,
  recordWashingMachineSample,
  type WashingMachineState,
} from "../washing-machine";
import type { WashingMachineConfig } from "../config-schema";
import { CONFIG, SAMPLE_SECONDS } from "./washing-machine.fixtures";

describe("pattern attribution rules", () => {
  const RULES = {
    enabled: true,
    personId: "addie",
    standardMinMinutes: 55,
    standardMaxMinutes: 95,
    minDaysSinceLast: 5,
    consecutiveMaxGapMinutes: 60,
    spinMaxMinutes: 15,
    spinMaxGapMinutes: 30,
  };
  const BASE = Date.parse("2026-09-20T08:00:00.000Z");
  const iso = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();
  const stored = (startMinutes: number, endMinutes: number, person: string | null, id = `c${startMinutes}`): WashingMachineCycle => ({
    costNzd: 0.1, endedAt: iso(endMinutes), id, kwh: 0.5, person, startedAt: iso(startMinutes),
  });
  const wash = (startMinutes: number, lengthMinutes: number) => ({ endedAt: iso(startMinutes + lengthMinutes), startedAt: iso(startMinutes) });
  const DAY = 24 * 60;
  // Long enough history, but none of hers recent — a baseline for day-gap.
  const oldHers = [stored(-6 * DAY, -6 * DAY + 66, "addie")];

  it("bounds the standard band inclusively", () => {
    expect(autoAttributeCycle(wash(0, 54), oldHers, RULES)).toBeNull();
    expect(autoAttributeCycle(wash(0, 55), oldHers, RULES)).toBe("day-gap");
    expect(autoAttributeCycle(wash(0, 95), oldHers, RULES)).toBe("day-gap");
    expect(autoAttributeCycle(wash(0, 96), oldHers, RULES)).toBeNull();
  });

  it("needs five days since her last wash", () => {
    const at = (days: number) => [stored(-days * DAY - 66, -days * DAY, "addie")];
    expect(autoAttributeCycle(wash(0, 66), at(4.9), RULES)).toBeNull();
    expect(autoAttributeCycle(wash(0, 66), at(5), RULES)).toBe("day-gap");
  });

  it("does not treat missing history as a long gap", () => {
    expect(autoAttributeCycle(wash(0, 66), [], RULES)).toBeNull();
    expect(autoAttributeCycle(wash(0, 66), [stored(-3 * DAY, -3 * DAY + 30, "tonya")], RULES)).toBeNull();
    expect(autoAttributeCycle(wash(0, 66), [stored(-5 * DAY, -5 * DAY + 30, "tonya")], RULES)).toBe("day-gap");
  });

  it("claims a standard wash straight after hers, up to an hour's gap", () => {
    const hers = [stored(-2 * DAY, -2 * DAY + 66, "addie", "old"), stored(-126, -60, "addie")];
    expect(autoAttributeCycle(wash(0, 66), hers, RULES)).toBe("consecutive");
    expect(autoAttributeCycle(wash(1, 66), hers, RULES)).toBeNull();
  });

  it("claims a spin straight after hers", () => {
    const hers = [stored(-2 * DAY, -2 * DAY + 66, "addie", "old"), stored(-96, -30, "addie")];
    expect(autoAttributeCycle(wash(0, 15), hers, RULES)).toBe("spin");
    expect(autoAttributeCycle(wash(0, 16), hers, RULES)).toBeNull();
    expect(autoAttributeCycle(wash(1, 15), hers, RULES)).toBeNull();
  });

  it("leaves a short wash after hers, or anything after someone else's, unassigned", () => {
    const hers = [stored(-2 * DAY, -2 * DAY + 66, "addie", "old"), stored(-76, -10, "addie")];
    expect(autoAttributeCycle(wash(0, 30), hers, RULES)).toBeNull();
    const tonyas = [stored(-2 * DAY, -2 * DAY + 66, "addie", "old"), stored(-40, -10, "tonya")];
    expect(autoAttributeCycle(wash(0, 66), tonyas, RULES)).toBeNull();
    expect(autoAttributeCycle(wash(0, 10), tonyas, RULES)).toBeNull();
  });

  it("never changes a manual claim, and reverts a guess that no longer holds", () => {
    const cycle = stored(0, 66, "tonya");
    const manual = { ...cycle, attribution: { at: iso(66), source: "manual" as const } };
    expect(settleAutoAttribution(manual, oldHers, RULES, iso(70))).toBe(manual);
    const legacy = stored(0, 30, "tonya");
    expect(settleAutoAttribution(legacy, oldHers, RULES, iso(70))).toBe(legacy);
    const guessed = { ...stored(0, 30, "addie"), attribution: { at: iso(30), rule: "day-gap" as const, source: "auto" as const } };
    const settled = settleAutoAttribution(guessed, oldHers, RULES, iso(70));
    expect(settled.person).toBeNull();
    expect(settled.attribution).toBeUndefined();
  });

  it("downsamples a trace to at most 48 points", () => {
    const points = Array.from({ length: 480 }, (_, index): [number, number] => [index * 30, index % 2 ? 100 : 300]);
    const curve = downsampleTrace(points);
    expect(curve).toHaveLength(48);
    expect(curve[0]).toBe(200);
    expect(downsampleTrace([[0, 5], [30, 6]])).toEqual([5, 6]);
  });
});

describe("pattern attribution through the sampler", () => {
  const ALERT_CONFIG: WashingMachineConfig = {
    ...CONFIG,
    completionAlert: {
      enabled: true, personId: "addie", soundFile: "done.mp3", zeroWatts: 0, quietSeconds: 60,
      maxSampleGapSeconds: 90, discord: true,
      drying: { hours: 4, daylightHours: 3, maxRainMm: 0.1, maxRainChancePct: 30 },
    },
    autoAttribution: {
      enabled: true, personId: "addie", standardMinMinutes: 55, standardMaxMinutes: 95, minDaysSinceLast: 5,
      consecutiveMaxGapMinutes: 60, spinMaxMinutes: 15, spinMaxGapMinutes: 30,
    },
  };

  function run(trace: Array<[number, number]>, state: WashingMachineState, startIso: string) {
    let at = Date.parse(startIso);
    let next = state;
    for (const [watts, minutes] of trace) {
      for (let tick = 0; tick < (minutes * 60) / SAMPLE_SECONDS; tick += 1) {
        at += SAMPLE_SECONDS * 1000;
        next = recordWashingMachineSample(next, {
          at: new Date(at).toISOString(), config: ALERT_CONFIG, costPerKwh: 0.3, elapsedHours: SAMPLE_SECONDS / 3600, watts,
        });
      }
    }
    return next;
  }

  const lastWeek: WashingMachineCycle = {
    costNzd: 0.1, endedAt: "2026-09-08T09:06:00.000Z", id: "last-week", kwh: 0.5, person: "addie", startedAt: "2026-09-08T08:00:00.000Z",
  };

  it("alerts for an unclaimed wash of hers, then a spin after it, but not a short wash", () => {
    const start = { ...blankWashingMachineState(), cycles: [lastWeek] };
    let state = run([[0, 5], [400, 66], [0, 10]], start, "2026-09-14T08:00:00.000Z");
    expect(state.cycles).toHaveLength(2);
    expect(state.cycles[1].completion?.person).toBe("addie");
    expect(state.cycles[1].completion?.discord).toBe(true);
    expect(state.cycles[1].person).toBe("addie");
    expect(state.cycles[1].attribution).toMatchObject({ rule: "day-gap", source: "auto" });

    state = run([[500, 12], [0, 10]], state, state.cycles[1].endedAt);
    expect(state.cycles).toHaveLength(3);
    expect(state.cycles[2].completion?.person).toBe("addie");
    expect(state.cycles[2].attribution).toMatchObject({ rule: "spin", source: "auto" });

    const short = run([[0, 5], [400, 30], [0, 10]], { ...blankWashingMachineState(), cycles: state.cycles.slice(0, 2) }, state.cycles[1].endedAt);
    expect(short.cycles[2].person).toBeNull();
    expect(short.cycles[2].completion?.person).toBeNull();
  });

  it("keeps a wash claimed by tap while running", () => {
    const start = { ...blankWashingMachineState(), cycles: [lastWeek] };
    let state = run([[0, 5], [400, 20]], start, "2026-09-14T08:00:00.000Z");
    state = { ...state, open: { ...state.open!, attribution: { at: "2026-09-14T08:20:00.000Z", source: "manual" }, person: "tonya" } };
    state = run([[400, 46], [0, 10]], state, "2026-09-14T08:25:00.000Z");
    expect(state.cycles[1].person).toBe("tonya");
    expect(state.cycles[1].attribution?.source).toBe("manual");
  });
});

describe("attribution cycling", () => {
  it("cycles unassigned through each person and back", () => {
    const people = ["addie", "tonya"];

    expect(nextPerson(null, people)).toBe("addie");
    expect(nextPerson("addie", people)).toBe("tonya");
    expect(nextPerson("tonya", people)).toBeNull();
  });

  it("stays unassigned when nobody is configured", () => {
    expect(nextPerson(null, [])).toBeNull();
  });

  it("treats an unknown person as the end of the list", () => {
    expect(nextPerson("someone-else", ["addie", "tonya"])).toBeNull();
  });
});
