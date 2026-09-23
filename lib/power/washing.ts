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
import { setWashTimer, syncWashTimer } from "./wash-timer";
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
import { buildWashHistory } from "./wash-history";
import type { PowerWashingMachineSummary, WashTraceFile } from "./types";

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

/**
 * Where a tap starts in the person order.
 *
 * A **default** attribution is not a claim — nobody made it — so a tap on one
 * claims the wash from the top of the order, exactly as an unassigned wash does.
 * Leaving it in the order meant a wash the household's default had picked up
 * could only be claimed by tapping past it, and the first tap read as the wash
 * being released (specs/power-meters.md 4.3).
 */
function tapFrom(cycle: { attribution?: WashAttribution; person?: string | null }) {
  return cycle.attribution?.source === "auto" ? null : cycle.person ?? null;
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
  // A tap is a manual claim, including a tap back to unassigned: the unclaimed
  // default never overrides it (§4.3).
  const attribution: WashAttribution = { at: new Date().toISOString(), source: "manual" };
  if (state.open?.startedAt && washingCycleId(state.open.startedAt) === cycleId) {
    state.open.person = nextPerson(tapFrom(state.open), personIds);
    state.open.attribution = attribution;
    // The wash's timer belongs to the primary person: this tap starts it, and a
    // tap that takes the wash off her cancels it, silently
    // (specs/power-meters.md, "The wash's timer").
    const timer = await setWashTimer(state.open, new Date());
    // A timer that has already finished keeps its record — the alert it raised is
    // still on the household's screen, and a tap must not start a second one for
    // a wash that has been notified. An unfinished one goes with the claim.
    if (timer) state.open.timer = timer;
    else if (state.open.timer?.completedAt === null) delete state.open.timer;
    await reconcileWashCompletion(state, new Map());
    await writeJsonAtomic(WASHING_MACHINE_PATH, state);
    return state.open;
  }
  if (index === -1) {
    return null;
  }
  const cycle = { ...state.cycles[index], attribution, person: nextPerson(tapFrom(state.cycles[index]), personIds) };
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
