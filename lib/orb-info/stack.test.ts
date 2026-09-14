import { describe, expect, it } from "vitest";
import { orbModuleById } from "./catalogue";
import type { OrbInfoSources } from "./catalogue";
import { resolveOrbEntries } from "./preferences";
import { resolveActiveEntry } from "./stack";
import { ORB_MODULE_OUTPUT_EMPTY, type OrbStackEntry } from "./types";
import { parseOrbInfoUpdateRequest } from "../api/dashboard-requests";

const entries: OrbStackEntry[] = [
  { id: "first", moduleId: "gym", activation: "whenAlerting" },
  { id: "second", moduleId: "clock", activation: "always" },
];
describe("priority stack", () => {
  it("falls through a quiet alert and selects it when it alerts", () => {
    const outputs = { first: { ...ORB_MODULE_OUTPUT_EMPTY }, second: { ...ORB_MODULE_OUTPUT_EMPTY } };
    expect(resolveActiveEntry(entries, outputs)?.entry.id).toBe("second");
    outputs.first.alert = true;
    expect(resolveActiveEntry(entries, outputs)?.entry.id).toBe("first");
  });
  it("an always entry blocks lower rows, except inactive events", () => {
    const rows = entries.map((entry) => ({ ...entry, activation: "always" as const }));
    const outputs = { first: { ...ORB_MODULE_OUTPUT_EMPTY, active: false }, second: ORB_MODULE_OUTPUT_EMPTY };
    expect(resolveActiveEntry(rows, outputs)?.entry.id).toBe("second");
    outputs.first.active = true;
    expect(resolveActiveEntry(rows, outputs)?.entry.id).toBe("first");
    expect(resolveActiveEntry([], outputs)).toBeNull();
  });
  it("migrates legacy display and keeps intentional empty stacks", () => {
    expect(resolveOrbEntries({ moduleId: "clock", modules: { clock: { display: { clock12Hour: true } } } })[0])
      .toMatchObject({ moduleId: "clock", activation: "always", display: { clock12Hour: true } });
    expect(resolveOrbEntries({ entries: [] })).toEqual([]);
  });
  it("retains distinct duplicate module settings across reordering", () => {
    const rows = [
      { ...entries[0], display: { decimals: 1 as const } },
      { ...entries[0], id: "another", display: { decimals: 3 as const } },
    ];
    const saved = parseOrbInfoUpdateRequest({ entries: rows.reverse() });
    expect(resolveOrbEntries(saved).map((entry) => [entry.id, entry.display?.decimals]))
      .toEqual([["another", 3], ["first", 1]]);
    expect(() => parseOrbInfoUpdateRequest({ entries: [entries[0], entries[0]] })).toThrow(/unique/);
  });
});

it("wash counts down, overruns and stays gone after acknowledgement", () => {
  const sources: OrbInfoSources = { now: 66000, watchface: null, novaLoad: null, power: null, dashboardState: null, tasks: null,
    washing: { primaryPersonId: "primary", etaAt: new Date(73000).toISOString(), open: { person: "primary", startedAt: new Date(0).toISOString() } } };
  const wash = orbModuleById("washing");
  expect(wash.read(sources).text).toBe("0:07");
  sources.now = 80000; expect(wash.read(sources).text).toBe("+0:07");
  sources.washing!.open!.completion = { at: new Date(80000).toISOString() };
  sources.washTasks = [{ id: "wash-test", start: new Date(80000).toISOString(), moduleData: { "washing-machine": { phase: "active" } } }];
  expect(wash.read(sources).dismiss?.id).toBe("wash-test");
  sources.washTasks[0].alertDismissedAt = new Date(81000).toISOString();
  expect(wash.read(sources).active).toBe(false);
});
