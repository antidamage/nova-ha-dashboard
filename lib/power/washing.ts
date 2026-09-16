// The washing machine: its tick, per-person attribution and monthly summary.
import path from "path";
import { readDashboardConfigSync } from "../dashboard-config";
import type { HaState } from "../types";
import { reconcileWashCompletion } from "../wash-completion";
import {
  blankWashingMachineState,
  cycleId as washingCycleId,
  monthTotals,
  nextPerson,
  pruneWashingMachineCycles,
  recordWashingMachineSample,
  WASHING_MACHINE_HISTORY_DAYS,
  type WashAttribution,
  type WashingMachineState,
} from "../washing-machine";
import { localMonthKey } from "./calendar";
import { meterReading } from "./meters";
import {
  powerConfig,
  readJson,
  runningWashCurve,
  serializePower,
  WASH_TRACE_DIR,
  washCurves,
  WASHING_MACHINE_PATH,
  writeJsonAtomic,
} from "./store";
import type { PowerWashingMachineSummary, WashTraceFile } from "./types";

export function recordWashingMachineTick(
  persisted: WashingMachineState,
  statesById: Map<string, HaState>,
  now: Date,
  integrationHours: number,
  costPerKwh: number,
  energyKwh?: number,
): WashingMachineState | null {
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
  const next = recordWashingMachineSample(persisted, {
    at: now.toISOString(),
    config,
    costPerKwh,
    elapsedHours: integrationHours,
    ...(energyKwh === undefined ? {} : { energyKwh }),
    watts,
    reportedAt: reading?.reportedAt ?? "invalid",
  });
  const cutoff = new Date(now.getTime() - WASHING_MACHINE_HISTORY_DAYS * 86_400_000).toISOString();
  return pruneWashingMachineCycles(next, cutoff);
}

/**
 * Attribute one wash to a person, or cycle it onward. Unassigned -> each
 * configured person in order -> unassigned. The caller sends the cycle id only;
 * the server owns the order so two screens cannot disagree about what comes
 * next. See specs/power-meters.md 4.3.
 */
async function attributeWashingMachineCycleUnlocked(cycleId: string) {
  if (!powerConfig().washingMachine) {
    return null;
  }
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  const state = { ...blankWashingMachineState(), ...persisted };
  const index = state.cycles.findIndex((cycle) => cycle.id === cycleId);
  const personIds = (readDashboardConfigSync().dashboard.people ?? []).map((person) => person.id);
  // A tap is a manual claim, including a tap back to unassigned: pattern
  // attribution never overrides it (§4.5).
  const attribution: WashAttribution = { at: new Date().toISOString(), source: "manual" };
  if (state.open?.startedAt && washingCycleId(state.open.startedAt) === cycleId) {
    state.open.person = nextPerson(state.open.person ?? null, personIds);
    state.open.attribution = attribution;
    await reconcileWashCompletion(state, new Map());
    await writeJsonAtomic(WASHING_MACHINE_PATH, state);
    return state.open;
  }
  if (index === -1) {
    return null;
  }
  const cycle = { ...state.cycles[index], attribution, person: nextPerson(state.cycles[index].person, personIds) };
  state.cycles = [...state.cycles.slice(0, index), cycle, ...state.cycles.slice(index + 1)];
  await writeJsonAtomic(WASHING_MACHINE_PATH, state);
  // The curve is logged against whoever the wash now belongs to.
  const tracePath = path.join(WASH_TRACE_DIR, `${cycle.id}.json`);
  const trace = await readJson<WashTraceFile | null>(tracePath, null);
  if (trace) await writeJsonAtomic(tracePath, { ...trace, attribution, person: cycle.person });
  return cycle;
}

/** Claim the wash currently under way; completed washes use the cycle path above. */
export async function attributeOpenWashingMachineCycle() {
  return serializePower(async () => {
    const state = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
    return state.open?.startedAt ? attributeWashingMachineCycleUnlocked(washingCycleId(state.open.startedAt)) : null;
  });
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
    typicalMinutes: config.typicalMinutes,
    etaAt: state.open?.startedAt ? new Date(Date.parse(state.open.startedAt) + config.typicalMinutes * 60_000).toISOString() : null,
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

export function attributeWashingMachineCycle(id: string) {
  return serializePower(() => attributeWashingMachineCycleUnlocked(id));
}
