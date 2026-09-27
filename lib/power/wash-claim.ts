// Who a wash belongs to, as a store write.
//
// Two surfaces write this and they ask different questions of the same wash: the
// panel's block is a *tap*, which cycles the attribution onward, while the
// laundry history's dropdown *names* the person. Both go through the one write
// here, so the two cannot disagree about what the store ends up holding.
// See specs/power-meters.md §4.3 and §5.3.
import path from "path";
import { readDashboardConfigSync } from "../dashboard-config";
import { reconcileWashCompletion } from "../wash-completion";
import {
  blankWashingMachineState,
  cycleId as washingCycleId,
  nextPerson,
  type WashAttribution,
  type WashingMachineState,
} from "../washing-machine";
import { powerConfig, readJson, serializePower, WASH_TRACE_DIR, WASHING_MACHINE_PATH, writeJsonAtomic } from "./store";
import { setWashTimer } from "./wash-timer";
import type { WashTraceFile } from "./types";

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
 * The owner a store write should end on, given what the wash holds now.
 *
 * The caller supplies the *question*, not the name, which is what lets one write
 * serve both a cycling tap and a picker that names somebody.
 */
type PersonChoice = (cycle: { attribution?: WashAttribution; person: string | null }, personIds: string[]) => string | null;

/**
 * Write one wash's owner. Either route is a manual claim, including one back to
 * unassigned, so the household's unclaimed default never overrides it (§4.3).
 */
async function writeWashPersonUnlocked(cycleId: string, choose: PersonChoice) {
  // No machine, no wash to attribute — the same guard the read paths carry. The
  // store can still hold cycles from a config that had one, so without this a
  // POST against a stale id would write a person and an attribution to a wash
  // the household no longer has a meter for.
  if (!powerConfig().washingMachine) {
    return null;
  }
  const personIds = (readDashboardConfigSync().dashboard.people ?? []).map((person) => person.id);
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  const state = { ...blankWashingMachineState(), ...persisted };
  const index = state.cycles.findIndex((cycle) => cycle.id === cycleId);
  const attribution: WashAttribution = { at: new Date().toISOString(), source: "manual" };
  if (state.open?.startedAt && washingCycleId(state.open.startedAt) === cycleId) {
    state.open.person = choose({ attribution: state.open.attribution, person: state.open.person ?? null }, personIds);
    state.open.attribution = attribution;
    // The wash's timer belongs to the primary person: this write starts it, and
    // one that takes the wash off her cancels it, silently
    // (specs/power-meters.md, "The wash's timer").
    const timer = await setWashTimer(state.open, new Date());
    // A timer that has already finished keeps its record — the alert it raised is
    // still on the household's screen, and a write must not start a second one for
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
  const cycle = { ...state.cycles[index], attribution, person: choose(state.cycles[index], personIds) };
  state.cycles = [...state.cycles.slice(0, index), cycle, ...state.cycles.slice(index + 1)];
  await writeJsonAtomic(WASHING_MACHINE_PATH, state);
  // The curve is logged against whoever the wash now belongs to.
  const tracePath = path.join(WASH_TRACE_DIR, `${cycle.id}.json`);
  const trace = await readJson<WashTraceFile | null>(tracePath, null);
  if (trace) await writeJsonAtomic(tracePath, { ...trace, attribution, person: cycle.person });
  return cycle;
}

/**
 * Cycle one wash's attribution onward: unassigned → each configured person in
 * order → unassigned. The caller sends the cycle id only; the server owns the
 * order so two screens cannot disagree about what comes next (§4.3).
 */
function cycleWashPersonUnlocked(cycleId: string) {
  return writeWashPersonUnlocked(cycleId, (cycle, personIds) => nextPerson(tapFrom(cycle), personIds));
}

/** Cycle a stored wash's attribution onward. */
export function attributeWashingMachineCycle(id: string) {
  return serializePower(() => cycleWashPersonUnlocked(id));
}

/** Claim the wash currently under way; completed washes use the cycle path above. */
export async function attributeOpenWashingMachineCycle() {
  return serializePower(async () => {
    const state = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
    return state.open?.startedAt ? cycleWashPersonUnlocked(washingCycleId(state.open.startedAt)) : null;
  });
}

/**
 * Name one wash's owner outright, or clear it — what the laundry history's
 * dropdown does (`specs/power-meters.md` §5.3).
 *
 * A name this household does not configure is **refused**, not written: people
 * come from config, so an id nothing resolves would read as Unassigned while the
 * store held somebody — the silent wrong answer a picker must never produce. The
 * refusal is a throw, which the route answers as a bad request.
 */
export async function setWashingMachineCyclePerson(options: {
  /** The wash under way rather than a stored one. */
  active?: boolean;
  cycleId?: string;
  person: string | null;
}) {
  const personIds = (readDashboardConfigSync().dashboard.people ?? []).map((person) => person.id);
  if (options.person !== null && !personIds.includes(options.person)) {
    throw new Error("That person is not one this household configures");
  }
  return serializePower(async () => {
    const stored = options.active
      ? (await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState())).open?.startedAt
      : options.cycleId;
    if (!stored) {
      return null;
    }
    return writeWashPersonUnlocked(options.active ? washingCycleId(stored) : stored, () => options.person);
  });
}
