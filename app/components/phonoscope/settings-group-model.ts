/**
 * Settings group maths: new groups and lanes, and how a lane's bindings are
 * read and laid out. Split out of `SettingsGroupLibrary.tsx`
 * (specs/agent-token-footprint.md §4); `laneQueries` holds the lookups that
 * closed over the card's props.
 */
import type {
  PhonoscopeDriverLane,
  PhonoscopeDriverType,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import {
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
} from "../../../lib/phonoscope-drivers";
import { isPhonoscopeSizeControlRelevant } from "../../../lib/phonoscope-effect-groups";
import { newId } from "./color-group-model";
import { isCompanionEffect } from "./effect-choices";
import { effectOptionFor } from "./effect-catalogue-model";
import { effectGroupIndex } from "./effect-groups-model";
import type { EffectOption, ResolvedEffectGroup } from "./types";

/** One row in a lane: either a lone effect, or a group with its parameters. */
export type LaneItem =
  | { kind: "binding"; binding: PhonoscopeEffectBinding }
  | { kind: "group"; group: ResolvedEffectGroup; bindings: PhonoscopeEffectBinding[] };

/** The first driver this group has no lane for, so new lanes read distinctly. */
export function unusedDriverType(lanes: PhonoscopeDriverLane[]): PhonoscopeDriverType {
  const taken = new Set(lanes.map((lane) => lane.driver.type));
  return NEW_LANE_ORDER.find((type) => !taken.has(type)) ?? "beat";
}

const NEW_LANE_ORDER: PhonoscopeDriverType[] = [
  "beat", "downbeat", "bass", "mid", "treble", "energy", "song", "timer", "random",
];

/** The lookups a settings group card makes against one lane. */
export function laneQueries({
  catalogue,
  effectGroups,
  hasImage,
}: {
  catalogue: EffectOption[];
  effectGroups: ResolvedEffectGroup[];
  hasImage: { centre: boolean; background: boolean };
}) {
  const groupOf = effectGroupIndex(effectGroups);

  /**
   * A size control's live value in this lane, or its declared default.
   *
   * Read from the lane rather than from the resolved picture because this is
   * the card's own state: the rows shown under a mode have to follow the mode
   * as it is set right here, not as it resolves after every other lane and
   * settings group has layered over it.
   */
  const sizeControlValue = (lane: PhonoscopeDriverLane, effectId: string) => {
    let resolved = effectOptionFor(catalogue, effectId)?.default ?? 0;
    for (const binding of lane.bindings) {
      if (binding.effect !== effectId) continue;
      const value = binding.min ?? binding.max;
      if (typeof value === "number" && Number.isFinite(value)) resolved = value;
    }
    return resolved;
  };

  const memberRelevance = (lane: PhonoscopeDriverLane, groupId: string) => {
    const centre = groupId === "centre";
    return (effectId: string) => isPhonoscopeSizeControlRelevant(groupId, effectId, {
      hasImage: centre ? hasImage.centre : hasImage.background,
      // The centre has no size mode — it is always manual — so it reports one.
      fit: centre ? 0 : sizeControlValue(lane, PHONOSCOPE_BG_FIT_EFFECT),
      proportional: sizeControlValue(lane,
        centre ? PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT : PHONOSCOPE_BG_PROPORTIONAL_EFFECT) >= 0.5,
    });
  };

  /** The bindings a lane puts on screen: companions are shown by their owner. */
  const visibleBindings = (lane: PhonoscopeDriverLane) =>
    lane.bindings.filter((binding) => !isCompanionEffect(binding.effect));

  /**
   * A lane's bindings as they are laid out: grouped ones collected under their
   * group, everything else on its own.
   *
   * A group sits where its first member sits, so adding a parameter to it does
   * not make the group jump down the lane. Members keep the lane's own order
   * rather than the group's declared order, for the same reason — the list is
   * stable under editing.
   */
  const laneItems = (lane: PhonoscopeDriverLane): LaneItem[] => {
    const seen = new Set<string>();
    return visibleBindings(lane).flatMap<LaneItem>((binding) => {
      const groupId = groupOf.get(binding.effect);
      if (!groupId) return [{ kind: "binding", binding }];
      if (seen.has(groupId)) return [];
      seen.add(groupId);
      const resolved = effectGroups.find((entry) => entry.id === groupId);
      if (!resolved) return [{ kind: "binding", binding }];
      return [{
        kind: "group",
        group: resolved,
        bindings: lane.bindings.filter((entry) => groupOf.get(entry.effect) === groupId),
      }];
    });
  };

  // Prefer the group's copy of the option: that is the one carrying the short
  // label the member reads by under its heading.
  const optionFor = (effectId: string) => {
    const groupId = groupOf.get(effectId);
    const resolved = groupId ? effectGroups.find((entry) => entry.id === groupId) : undefined;
    return (resolved && effectOptionFor(resolved.members, effectId))
      ?? effectOptionFor(catalogue, effectId);
  };

  return { groupOf, sizeControlValue, memberRelevance, visibleBindings, laneItems, optionFor };
}

export function newSettingsGroup(moduleId: string, name: string): PhonoscopeSettingsGroup {
  return {
    id: newId("settings"),
    name,
    moduleId,
    lanes: [],
    combine: {},
    staticSettings: {},
    isDefault: false,
  };
}
