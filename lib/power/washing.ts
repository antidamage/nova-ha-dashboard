// The washing machine: its tick, the month's summary, and the graph's day read.
// Attribution is a store write of its own — see ./wash-claim.
import type { HaState } from "../types";
import { readDashboardConfigSync } from "../dashboard-config";
import {
  blankWashingMachineState,
  cycleId as washingCycleId,
  monthTotals,
  pruneWashingMachineCycles,
  recordWashingMachineSample,
  WASHING_MACHINE_HISTORY_DAYS,
  type WashingMachineState,
} from "../washing-machine";
import { localMonthKey } from "./calendar";
import { meterReading } from "./meters";
import {
  powerConfig,
  readJson,
  runningWashCurve,
  washCurves,
  WASHING_MACHINE_PATH,
  writeJsonAtomic,
} from "./store";
import { syncWashTimer } from "./wash-timer";
import { buildWashHistory } from "./wash-history";
import type { PowerWashingMachineSummary } from "./types";

export async function recordWashingMachineTick(
  persisted: WashingMachineState,
  statesById: Map<string, HaState>,
  now: Date,
  integrationHours: number,
  costPerKwh: number,
  energyKwh?: number,
): Promise<WashingMachineState | null> {
  const config = powerConfig().washingMachine;
  if (!config) {
    return null;
  }
  const reading = meterReading(statesById, config);
  const watts = reading?.watts ?? null;
  if (watts === null) {
    // Off-network. A missing reading is not a reading of zero: treating it as
    // one would close an open cycle that is still running.
    if (persisted.open) { persisted.open.zeroSince = null; persisted.open.belowSince = null; }
    return persisted;
  }
  const beforeTimer = persisted.open?.timer;
  const next = recordWashingMachineSample(persisted, {
    at: now.toISOString(),
    config,
    costPerKwh,
    elapsedHours: integrationHours,
    ...(energyKwh === undefined ? {} : { energyKwh }),
    watts,
    reportedAt: reading?.reportedAt ?? "invalid",
  });
  // The wash's timer drives the household's: whatever this tick did to it —
  // extended it, finished it, or removed it with the wash — reaches the timer
  // every screen reads (specs/power-meters.md, "The wash's timer").
  await syncWashTimer(beforeTimer, next.open?.timer);
  const cutoff = new Date(now.getTime() - WASHING_MACHINE_HISTORY_DAYS * 86_400_000).toISOString();
  return pruneWashingMachineCycles(next, cutoff);
}

export function buildWashingMachineSummary(
  state: WashingMachineState | null,
  now: Date,
): PowerWashingMachineSummary | undefined {
  const config = powerConfig().washingMachine;
  if (!config || !state) {
    return undefined;
  }
  const people = readDashboardConfigSync().dashboard.people ?? [];
  const monthKey = localMonthKey(now);
  // Calendar month, in this household's own timezone -- NOT the retailer's
  // billing cycle the rest of the panel uses. A shared cost is split by the
  // month people actually live in. See specs/power-meters.md 4.4.
  const cycles = state.cycles.filter((cycle) => localMonthKey(new Date(cycle.endedAt)) === monthKey);
  return {
    primaryPersonId: people.find((person) => person.primary)?.id,
    cycles: cycles.map((cycle) => (washCurves.has(cycle.id) ? { ...cycle, curve: washCurves.get(cycle.id) } : cycle)),
    ...(state.open?.startedAt ? { running: {
      ...(state.open.attribution ? { attribution: state.open.attribution } : {}),
      ...(runningWashCurve ? { curve: runningWashCurve } : {}),
      id: washingCycleId(state.open.startedAt), person: state.open.person ?? null, kwh: state.open.kwh,
    } } : {}),
    monthKey,
    open: state.open?.startedAt ? state.open : null,
    people,
    totals: monthTotals(cycles, people.map((person) => person.id)),
    watts: state.open?.lastWatts ?? null,
  };
}

/**
 * One local day of the wash graph, plus the days that hold a wash so the
 * graph's buttons can skip the empty ones. `atMs` names the day; without it the
 * newest day holding a wash is read. See specs/power-meters.md 5.2.
 */
export async function readWashHistory(atMs: number | null) {
  if (!powerConfig().washingMachine) {
    return null;
  }
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  return buildWashHistory({ ...blankWashingMachineState(), ...persisted }, atMs, new Date());
}

/**
 * Attribution is a store write of its own — see ./wash-claim — re-exported here
 * so its callers (the API route, the facade and the suites) keep their import.
 */
export { attributeOpenWashingMachineCycle, attributeWashingMachineCycle, setWashingMachineCyclePerson } from "./wash-claim";

export function washReconcileSignature(state: WashingMachineState) {
  const open = state.open;
  const last = state.cycles[state.cycles.length - 1];
  const alert = powerConfig().washingMachine?.completionAlert;
  return JSON.stringify([
    alert?.enabled ?? false, alert?.personId ?? null,
    open?.startedAt ?? null, open?.person ?? null, open?.completion?.at ?? null,
    state.cycles.length, last?.id ?? null, last?.person ?? null, last?.completion?.at ?? null,
  ]);
}
