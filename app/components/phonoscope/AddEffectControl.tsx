"use client";

import { Plus } from "lucide-react";
import { ConfigSelect } from "../ConfigSelect";
import { effectGroupIndex } from "./effect-groups-model";
import type { EffectOption, ResolvedEffectGroup } from "./types";

/**
 * The "+ Add effect" control at the bottom of a lane.
 *
 * Grouped effects are offered as their group — one "Glow" entry rather than
 * five — and picking one adds its first member. Everything the groups do not
 * claim is listed as before.
 *
 * Split out of `EffectEntry.tsx` (specs/agent-token-footprint.md §4), which
 * still re-exports it.
 */
export function AddEffectControl({
  catalogue,
  groups,
  onAdd,
  onAddGroup,
}: {
  catalogue: EffectOption[];
  groups: ResolvedEffectGroup[];
  onAdd: (effectId: string) => void;
  onAddGroup: (group: ResolvedEffectGroup) => void;
}) {
  const grouped = effectGroupIndex(groups);
  // A companion is not something you add: the control set that owns it decides
  // when it exists, so offering it here would be offering a second way in.
  const ungrouped = catalogue.filter((effect) => !grouped.has(effect.id) && !effect.companion);
  const sections = [...new Set(ungrouped.map((effect) => effect.section))];
  return (
    <ConfigSelect
      label="Add effect"
      value=""
      options={[
        { value: "", label: "Add effect…" },
        ...groups.map((group) => ({
          value: `group:${group.id}`,
          label: group.label,
          detail: group.section,
        })),
        ...sections.flatMap((section) => ungrouped
          .filter((effect) => effect.section === section)
          .map((effect) => ({
            value: effect.id,
            label: effect.label,
            detail: section,
          }))),
      ]}
      onChange={(value) => {
        if (!value) return;
        const group = groups.find((entry) => `group:${entry.id}` === value);
        if (group) onAddGroup(group);
        else onAdd(value);
      }}
    />
  );
}

export function addEffectIcon() {
  return <Plus className="h-4 w-4" />;
}
