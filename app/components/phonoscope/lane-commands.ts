/**
 * The edits a settings group card makes to its lanes. Split out of
 * `SettingsGroupLibrary.tsx` (specs/agent-token-footprint.md §4); these are the
 * handlers that closed over the card's `group` and `onChange`.
 */
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriverLane,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { newId } from "./color-group-model";

export function laneCommands({
  group,
  onChange,
}: {
  group: PhonoscopeSettingsGroup;
  onChange: (group: PhonoscopeSettingsGroup, commit?: boolean) => void;
}) {
  const updateLane = (laneId: string, patch: Partial<PhonoscopeDriverLane>) =>
    onChange({
      ...group,
      lanes: group.lanes.map((lane) => lane.id === laneId ? { ...lane, ...patch } : lane),
    });

  const moveLane = (index: number, delta: -1 | 1) => {
    const next = [...group.lanes];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...group, lanes: next });
  };

  /**
   * Set a companion value in a lane: update the binding that carries it, or add
   * one pinned to that value if the lane has none yet.
   *
   * Pinned means both ends of the range sit on the number — these axes are
   * latched for the length of a transition, so there is nothing for a driver to
   * sweep between.
   */
  const setCompanion = (
    lane: PhonoscopeDriverLane,
    effectId: string,
    value: number,
  ) => {
    const existing = lane.bindings.some((entry) => entry.effect === effectId);
    updateLane(lane.id, {
      bindings: existing
        ? lane.bindings.map((entry) => entry.effect === effectId
          ? { ...entry, min: value, max: value }
          : entry)
        : [...lane.bindings, { id: newId("bind"), effect: effectId, min: value, max: value }],
    });
  };

  /**
   * One ramp across a parameter group: the same attack/hold/release written to
   * every parameter of it that can take one, in a single update.
   */
  const setSharedRamp = (
    lane: PhonoscopeDriverLane,
    effectIds: string[],
    [attackSeconds, holdSeconds, releaseSeconds]: [number, number, number],
  ) => {
    const ramped = new Set(effectIds);
    updateLane(lane.id, {
      bindings: lane.bindings.map((entry) => ramped.has(entry.effect)
        ? { ...entry, attackSeconds, holdSeconds, releaseSeconds }
        : entry),
    });
  };

  /**
   * One stacking mode across a parameter group: the same mode written to every
   * parameter of it that stacks, including the ones this lane has not added
   * yet, so a parameter joining later lands stacking the way the group does.
   *
   * `combine` is keyed by effect and lives on the settings group, so this is
   * shared by every appearance of those parameters, exactly as it was when the
   * control sat on the individual parameter.
   */
  const setSharedCombine = (effectIds: string[], mode: PhonoscopeCombineMode) => {
    onChange({
      ...group,
      combine: {
        ...group.combine,
        ...Object.fromEntries(effectIds.map((effectId) => [effectId, mode])),
      },
    });
  };

  return { updateLane, moveLane, setCompanion, setSharedRamp, setSharedCombine };
}
