import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../types";
import { driverSignal } from "./driver-signal";
import {
  isPhonoscopeOverrideOnlyEffect,
  PHONOSCOPE_MAX_LANE_SIGNAL,
  PHONOSCOPE_OVERSHOOT_RANGES,
} from "./effects";
import {
  driverPeriodSeconds,
  finite,
  PHONOSCOPE_DIVIDE_CHOICES,
  seedFraction,
  stablePhonoscopeSeed,
  stateFor,
} from "./signal-model";
import type { PhonoscopeDriverStates, PhonoscopeEffectDeclaration, PhonoscopeSignalFrame } from "./types";

/**
 * The lanes and scalars of several settings groups, merged in the order the
 * colour group entry named them: lanes stack, scalars layer.
 */
export function mergePhonoscopeSettingsGroups(groups: PhonoscopeSettingsGroup[]) {
  const lanes: { groupId: string; lane: PhonoscopeDriverLane }[] = [];
  const combine: Record<string, PhonoscopeCombineMode> = {};
  const staticSettings: Record<string, number> = {};
  for (const group of groups) {
    for (const lane of group.lanes ?? []) lanes.push({ groupId: group.id, lane });
    // A later group in the entry's list wins any scalar the earlier ones also
    // set, so reading the list top to bottom reads as layering.
    Object.assign(combine, group.combine ?? {});
    Object.assign(staticSettings, group.staticSettings ?? {});
  }
  return { lanes, combine, staticSettings };
}

type Contribution = {
  amount: number;
  period: number;
  restingValue: number;
};

/**
 * How far up its range a binding reaches this tick, 0..1.
 *
 * Normally 1 — the lane sweeps the whole authored range. With `randomValue` the
 * top of the sweep is drawn at random on each lane event and held until the
 * next one, so the envelope still ramps from the bottom of the range but stops
 * somewhere new every time.
 *
 * The draw is keyed off the primary driver's event key, which changes exactly
 * when the lane fires. Each binding draws from its own slot key, so two
 * randomised effects in one lane move independently rather than in lockstep.
 *
 * A continuous driver never writes an event key, so a level-driven lane draws
 * once and holds it — there is no event to re-draw on. The UI says so.
 */
function randomValueScale(
  binding: PhonoscopeEffectBinding,
  states: PhonoscopeDriverStates,
  slot: string,
) {
  if (!binding.randomValue) return 1;
  const roll = stateFor(states, `${slot}:rnd`);
  const eventKey = states.get(`${slot}:0`)?.eventKey ?? "";
  if (!roll.seeded || eventKey !== roll.eventKey) {
    roll.seeded = true;
    roll.eventKey = eventKey;
    roll.target = seedFraction(stablePhonoscopeSeed(`${slot}:rnd:${eventKey}`));
  }
  return roll.target;
}

/**
 * Resolve every effect the given lanes drive.
 *
 * A binding maps its lane's signal across `[min, max]`, so on its own it
 * behaves exactly as a single pre-lane parameter source did. Stacking is
 * expressed as contribution *above* a shared resting value — the highest `min`
 * among the effect's bindings — so two resting bindings never double their
 * floor, and `add` genuinely means "this much more on top".
 */
export function evaluatePhonoscopeDriverLanes(input: {
  lanes: { groupId: string; lane: PhonoscopeDriverLane }[];
  combine: Record<string, PhonoscopeCombineMode>;
  declarations: Map<string, PhonoscopeEffectDeclaration>;
  frame: PhonoscopeSignalFrame;
  states: PhonoscopeDriverStates;
}): { values: Record<string, number>; driven: Set<string> } {
  const { lanes, combine, declarations, frame, states } = input;
  const contributions = new Map<string, Contribution[]>();

  for (const { groupId, lane } of lanes) {
    const lanePeriod = driverPeriodSeconds(lane.driver, frame);
    for (const binding of lane.bindings ?? []) {
      const declaration = declarations.get(binding.effect);
      if (!declaration) continue;
      const low = clampToDeclaration(declaration, binding.min ?? declaration.min);
      const high = Math.max(low, clampToDeclaration(declaration, binding.max ?? declaration.max));
      const slot = `${groupId}:${lane.id}:${binding.id}`;
      let signal = driverSignal(lane.driver, binding, frame, states, `${slot}:0`);
      // Modifiers add to the main driver rather than gating it, so "downbeat
      // plus bass" reads as the hit sitting on top of whatever the bass is
      // already doing.
      (lane.modifiers ?? []).forEach((modifier, index) => {
        signal += driverSignal(modifier, binding, frame, states, `${slot}:${index + 1}`);
      });
      signal = Math.max(0, Math.min(PHONOSCOPE_MAX_LANE_SIGNAL, signal));
      const reach = randomValueScale(binding, states, slot);
      const list = contributions.get(binding.effect) ?? [];
      list.push({ amount: (high - low) * signal * reach, period: lanePeriod, restingValue: low });
      contributions.set(binding.effect, list);
    }
  }

  const values: Record<string, number> = {};
  const driven = new Set<string>();
  for (const [effect, list] of contributions) {
    const declaration = declarations.get(effect);
    if (!declaration || list.length === 0) continue;
    const mode = combineMode(effect, combine[effect]);
    let resting = list.reduce((highest, entry) => Math.max(highest, entry.restingValue), -Infinity);
    let total = 0;
    if (mode === "override") {
      // A replacement, not a contribution: the last lane in merge order takes
      // the effect outright and brings its OWN resting value with it, rather
      // than sitting on the shared floor every other mode builds from. That is
      // what makes an override settings group beat the defaults instead of
      // adding to them.
      const winner = list[list.length - 1];
      resting = winner.restingValue;
      total = winner.amount;
    } else if (mode === "add") {
      total = list.reduce((sum, entry) => sum + entry.amount, 0);
    } else {
      // One firing lane takes the effect outright, chosen by how often it
      // fires: `strongest` wants the least frequent, `common` the most.
      // Equal periods fall back to lane order, last one winning, which matches
      // the way colliding scalars layer.
      //
      // A continuous driver has no period at all (0), so under `strongest` it
      // never wins outright. `common` has to exclude it explicitly for the same
      // reason inverted — otherwise a level lane, being the "most frequent"
      // thing there is, would win every time and no pulse could ever be heard.
      const rarest = mode === "strongest";
      let best: Contribution | null = null;
      for (const entry of list) {
        if (entry.amount === 0) continue;
        if (!rarest && !(entry.period > 0)) continue;
        if (!best || (rarest ? entry.period >= best.period : entry.period <= best.period)) {
          best = entry;
        }
      }
      // Nothing but continuous lanes are contributing, so `common` falls back to
      // summing them rather than going silent.
      if (!best && !rarest) total = list.reduce((sum, entry) => sum + entry.amount, 0);
      else total = best ? best.amount : 0;
    }
    const range = Math.max(0, declaration.max - declaration.min);
    const ceiling = resting + range * PHONOSCOPE_OVERSHOOT_RANGES;
    const value = resting + total;
    values[effect] = Number.isFinite(value)
      ? Math.max(declaration.min, Math.min(ceiling, value))
      : declaration.default;
    driven.add(effect);
  }
  return { values, driven };
}

/**
 * The mode an effect actually combines by.
 *
 * Override-only effects ignore whatever a settings group stored: a transition
 * cannot be half one thing and half another, so the axis is forced no matter
 * how an older configuration was authored. Anything unrecognised reads as
 * `add`, which is the behaviour every effect had before combine modes existed.
 */
function combineMode(effect: string, stored: PhonoscopeCombineMode | undefined) {
  if (isPhonoscopeOverrideOnlyEffect(effect)) return "override";
  if (stored === "strongest" || stored === "common" || stored === "override") return stored;
  return "add";
}

function clampToDeclaration(declaration: PhonoscopeEffectDeclaration, value: number) {
  const low = Math.min(declaration.min, declaration.max);
  const high = Math.max(declaration.min, declaration.max);
  const bounded = Math.max(low, Math.min(high, finite(value, declaration.default)));
  if (!(declaration.step > 0)) return bounded;
  const stepped = low + Math.round((bounded - low) / declaration.step) * declaration.step;
  return Math.max(low, Math.min(high, stepped));
}

/** A driver with every field populated, for building defaults in the UI and tests. */
export function phonoscopeDriver(partial: Partial<PhonoscopeDriver> = {}): PhonoscopeDriver {
  const requested = Math.floor(finite(partial.divide ?? 1, 1));
  const type = partial.type ?? "beat";
  const cadence = partial.cadence ?? "beat";
  // Only the two musical pulses subdivide, so switching a subdivided lane to
  // `song` or `timer` drops the subdivision rather than parking a value the
  // engines would ignore.
  const pulse = type === "random" ? cadence : type;
  const divide = PHONOSCOPE_DIVIDE_CHOICES.includes(requested)
    && (pulse === "beat" || pulse === "downbeat")
    ? requested
    : 1;
  // Counting and subdividing are the two directions of one control, so a
  // subdivided driver is always "every one" — and an offset within a cycle of
  // one is nothing at all.
  const every = divide > 1 ? 1 : Math.max(1, Math.min(16, Math.floor(finite(partial.every ?? 1, 1))));
  return {
    type,
    every,
    divide,
    // An offset only means anything inside the cycle it offsets within.
    offset: Math.max(0, Math.min(every - 1, Math.floor(finite(partial.offset ?? 0, 0)))),
    intervalSeconds: Math.max(0.25, Math.min(600, finite(partial.intervalSeconds ?? 4, 4))),
    cadence,
  };
}
