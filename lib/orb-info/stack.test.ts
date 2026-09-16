import { describe, expect, it } from "vitest";
import { orbModuleById } from "./catalogue";
import type { OrbInfoSources } from "./catalogue";
import { resolveOrbEntries } from "./preferences";
import { orbEntryState, orderOrbStack, resolveActiveEntry } from "./stack";
import { ORB_MODULE_OUTPUT_EMPTY, type OrbModuleOutput, type OrbStackEntry } from "./types";
import cases from "./stack-cases.json";
import { parseOrbInfoUpdateRequest } from "../api/dashboard-requests";

const entries: OrbStackEntry[] = [
  { id: "first", moduleId: "openings-open", enabled: true, activation: "whenAlerting" },
  { id: "second", moduleId: "clock", enabled: true },
];
type CaseOutput = Partial<OrbModuleOutput>;
const table = cases as unknown as { cases: Array<{ name: string; entries: Array<Partial<OrbStackEntry> & { id: string; moduleId: string }>; outputs: Record<string, CaseOutput>; expectOrder: string[] }> };

describe("stack ordering (shared case table)", () => {
  for (const row of table.cases) {
    it(row.name, () => {
      const rows = row.entries.map((entry) => ({ enabled: true, ...entry }));
      const outputs = Object.fromEntries(Object.entries(row.outputs).map(([id, value]) => [id, { ...ORB_MODULE_OUTPUT_EMPTY, ...value }]));
      expect(orderOrbStack(rows, outputs).map((item) => item.entry.id)).toEqual(row.expectOrder);
    });
  }
});

describe("priority stack", () => {
  it("an alert-only row appears only while it alerts", () => {
    const rows = resolveOrbEntries({ entries: entries });
    const outputs = { first: { ...ORB_MODULE_OUTPUT_EMPTY }, second: { ...ORB_MODULE_OUTPUT_EMPTY } };
    expect(orderOrbStack(rows, outputs).map((item) => item.entry.id)).toEqual(["second"]);
    outputs.first.alert = true;
    expect(resolveActiveEntry(rows, outputs)?.entry.id).toBe("first");
    expect(resolveActiveEntry([], outputs)).toBeNull();
  });
  it("a gym alert sits at the bottom rather than taking the orb", () => {
    const rows: OrbStackEntry[] = [{ id: "gym", moduleId: "gym", enabled: true }, { id: "clock", moduleId: "clock", enabled: true }];
    const outputs = { gym: { ...ORB_MODULE_OUTPUT_EMPTY, alert: true }, clock: { ...ORB_MODULE_OUTPUT_EMPTY } };
    expect(orderOrbStack(rows, outputs).map((item) => item.entry.id)).toEqual(["clock", "gym"]);
    expect(resolveActiveEntry(rows, outputs)?.entry.id).toBe("clock");
  });
  it("threshold alerts without timestamps order by first-seen time", () => {
    const rows: OrbStackEntry[] = [{ id: "a", moduleId: "openings-open", enabled: true }, { id: "b", moduleId: "lights-on", enabled: true }];
    const alert = { ...ORB_MODULE_OUTPUT_EMPTY, alert: true };
    expect(orderOrbStack(rows, { a: alert, b: alert }, { a: 10, b: 20 }).map((item) => item.entry.id)).toEqual(["b", "a"]);
  });
  it("gym is off at 23 h, on at 24 h and alerts at its threshold", () => {
    const hour = 3_600_000;
    const gym = orbModuleById("gym");
    const row = resolveOrbEntries({ entries: [{ id: "gym", moduleId: "gym", enabled: true }] })[0];
    expect(row.params?.showAfterHours).toBe(24);
    const at = (hours: number) => orbEntryState(row, gym.read({ now: hours * hour, watchface: { gymLastResetAt: 0, gymAlertThresholdHours: 46 },
      novaLoad: null, power: null, dashboardState: null, tasks: null }, row.params));
    expect([at(23), at(24), at(45.9), at(46)]).toEqual(["off", "on", "on", "alert"]);
  });
  it("migrates legacy activation and display, and keeps intentional empty stacks", () => {
    expect(resolveOrbEntries({ moduleId: "clock", modules: { clock: { display: { clock12Hour: true } } } })[0])
      .toMatchObject({ moduleId: "clock", enabled: true, display: { clock12Hour: true } });
    const migrated = resolveOrbEntries({ entries: [
      { id: "a", moduleId: "clock", activation: "always" } as unknown as OrbStackEntry,
      { id: "b", moduleId: "gym", activation: "whenAlerting" } as unknown as OrbStackEntry,
    ] });
    expect(migrated.map(({ enabled, showOnlyWhenAlerting }) => [enabled, showOnlyWhenAlerting ?? false])).toEqual([[true, false], [true, true]]);
    expect(migrated[0]).not.toHaveProperty("activation");
    expect(resolveOrbEntries({ entries: [] })).toEqual([]);
  });
  it("due reminders alert with a reminder dismiss target", () => {
    const read = orbModuleById("reminders-overdue").read({ now: 0, watchface: null, novaLoad: null, power: null, dashboardState: null,
      tasks: { nextDueInHours: null, nextDueAt: null, overdueCount: 2, alerting: [{ id: "r2", start: new Date(5000).toISOString() }] } });
    expect(read).toMatchObject({ alert: true, alertAt: 5000, dismiss: { kind: "reminder", id: "r2" } });
  });
  it("retains distinct duplicate module settings across reordering", () => {
    const rows = [
      { ...entries[0], display: { decimals: 1 as const } },
      { ...entries[0], id: "another", display: { decimals: 3 as const }, enabled: false },
    ];
    const saved = parseOrbInfoUpdateRequest({ entries: rows.reverse() });
    expect(resolveOrbEntries(saved).map((entry) => [entry.id, entry.display?.decimals, entry.enabled]))
      .toEqual([["another", 3, false], ["first", 1, true]]);
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
