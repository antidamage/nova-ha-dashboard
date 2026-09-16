import type { PhonoscopeEffectBinding, PhonoscopePreferences, PhonoscopeSettingsGroup } from "../types";
import {
  mergePhonoscopeSettingsGroups,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
} from "../phonoscope-drivers";
import type { PhonoscopeTransition, TransitionAxes } from "./types";

/**
 * An instant change: no ramp at all, and therefore no mode worth naming.
 *
 * A solo lock, a first selection and an empty group are all cuts — "hold it
 * here" rather than "move to there" — and a flip or a slide with nowhere to
 * spend its time would just be a frame of missing image.
 */
export function cutTransition(seconds = 0): PhonoscopeTransition {
  return {
    attackSeconds: 0,
    holdSeconds: 0,
    // A cut's whole duration is its ease-out, so `transitionSeconds` (the sum)
    // keeps carrying the number the palette chase has always read.
    releaseSeconds: Math.max(0, seconds),
    mode: 0,
    axisDegrees: 0,
    divisions: 0,
    returnFromOrigin: false,
  };
}

/**
 * The value an override-only axis resolves to across a set of settings groups.
 *
 * Last one wins, which is the whole of `override`: the entry lists its groups
 * in layering order, so an override group placed after the defaults replaces
 * what they set. Nothing sums, and a group that says nothing about the axis
 * leaves the earlier answer standing.
 *
 * The value is the binding's pinned range — `min` and `max` are the same number
 * on these axes — so no driver signal is involved. That is deliberate: the axis
 * is latched for the length of the transition, so a swept value would be
 * sampled exactly once and the sweep would be a lie.
 */
function overrideAxis(
  groups: PhonoscopeSettingsGroup[],
  effect: string,
  fallback: number,
): number {
  let resolved = fallback;
  for (const { lane } of mergePhonoscopeSettingsGroups(groups).lanes) {
    for (const binding of lane.bindings ?? []) {
      if (binding.effect !== effect) continue;
      const value = binding.min ?? binding.max;
      if (typeof value === "number" && Number.isFinite(value)) resolved = value;
    }
  }
  return resolved;
}


const CENTRE_TRANSITION_AXES: TransitionAxes = {
  mode: PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  axis: PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  divisions: PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  returnEdge: PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
};

export const BACKGROUND_TRANSITION_AXES: TransitionAxes = {
  mode: PHONOSCOPE_BG_TRANSITION_EFFECT,
  axis: PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  divisions: PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  returnEdge: PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
};

/**
 * The ramp the transition itself carries, if it carries one.
 *
 * The transition's control set always shows a ramp, because every transition
 * has one, and it is authored on the transition rather than on the pulse that
 * fires it — the pulse says "change now", the transition says how long the
 * change takes and how it accelerates. Resolved last-wins over the same
 * settings groups as the other axes, so an override group's ramp replaces the
 * defaults' along with the rest of its transition.
 *
 * Undefined when no settings group binds a transition at all, in which case the
 * pulse's own envelope is still the ramp — that is what it meant before the
 * transition modes existed, and a group authored back then keeps working.
 */
function overrideRamp(
  groups: PhonoscopeSettingsGroup[],
  modeEffect: string,
): [number, number, number] | undefined {
  let resolved: [number, number, number] | undefined;
  for (const { lane } of mergePhonoscopeSettingsGroups(groups).lanes) {
    for (const binding of lane.bindings ?? []) {
      if (binding.effect !== modeEffect) continue;
      if (binding.attackSeconds === undefined && binding.holdSeconds === undefined
        && binding.releaseSeconds === undefined) continue;
      resolved = [
        Math.max(0, binding.attackSeconds ?? 0),
        Math.max(0, binding.holdSeconds ?? 0),
        Math.max(0, binding.releaseSeconds ?? 0),
      ];
    }
  }
  return resolved;
}

/**
 * The transition a firing pulse hands to the change it is about to make.
 *
 * Resolved from the settings groups in effect NOW — before the rotation moves
 * and swaps them — which is what makes the initiator, not the destination, the
 * owner of how the picture changes.
 */
export function transitionFrom(
  config: PhonoscopePreferences,
  settingsGroupIds: string[],
  binding: PhonoscopeEffectBinding,
  axes: TransitionAxes = CENTRE_TRANSITION_AXES,
): PhonoscopeTransition {
  const byId = new Map((config.settingsGroups ?? []).map((group) => [group.id, group]));
  const groups = settingsGroupIds
    .map((id) => byId.get(id))
    .filter((group): group is PhonoscopeSettingsGroup => Boolean(group));
  const ramp = overrideRamp(groups, axes.mode);
  return {
    attackSeconds: ramp ? ramp[0] : Math.max(0, binding.attackSeconds ?? 0.05),
    holdSeconds: ramp ? ramp[1] : Math.max(0, binding.holdSeconds ?? 0),
    releaseSeconds: ramp ? ramp[2] : Math.max(0, binding.releaseSeconds ?? 0.6),
    mode: clampInteger(overrideAxis(groups, axes.mode, 0), 0, 2),
    // Wrapped rather than clamped: 360 and 0 are the same direction, and an
    // authored 360 should not read as a different transition from an authored 0.
    axisDegrees: ((Math.round(overrideAxis(groups, axes.axis, 0)) % 360) + 360) % 360,
    divisions: clampInteger(overrideAxis(groups, axes.divisions, 0), 0, 10),
    returnFromOrigin: overrideAxis(groups, axes.returnEdge, 0) >= 0.5,
  };
}

function clampInteger(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}

/** The whole length of a transition: its ramp's three phases, end to end. */
export function transitionLength(transition: PhonoscopeTransition) {
  return transition.attackSeconds + transition.holdSeconds + transition.releaseSeconds;
}

