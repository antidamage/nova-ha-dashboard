"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PhonoscopeEffectBinding } from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { ConfigAccordion } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import type { ResolvedEffectGroup } from "./effectCatalogue";

/**
 * One appearance of an effect group inside a lane.
 *
 * A group is one thing you add — Glow, Background, Grid — and its members are
 * parameters you then add to it, exactly as a binding's range and envelope are
 * parameters you add to a binding. It owns no state of its own: each member is
 * still an ordinary `EffectEntry` over an ordinary binding, and this only
 * decides which of them are on screen and under what heading.
 *
 * Removing the group removes every member binding in this lane, because an
 * empty group is not a state the picker can produce — you would have to add it
 * again to get anything back.
 */
export function EffectGroupEntry({
  bindings,
  group,
  laneId,
  onAdd,
  onRemoveAll,
  renderMember,
}: {
  /** This lane's bindings for members of this group, in the group's order. */
  bindings: PhonoscopeEffectBinding[];
  group: ResolvedEffectGroup;
  laneId: string;
  onAdd: (effectId: string) => void;
  onRemoveAll: () => void;
  renderMember: (binding: PhonoscopeEffectBinding) => ReactNode;
}) {
  const bound = new Set(bindings.map((binding) => binding.effect));
  // A member already in this lane is not offered again. Adding the same effect
  // twice to one lane is legal — two appearances stack — but it is a deliberate
  // act, and the way to do it stays the duplicate action on the member itself.
  const missing = group.members.filter((member) => !bound.has(member.id));

  return (
    <ConfigAccordion
      id={`effect-group-${laneId}-${group.id}`}
      title={group.label}
      className="border border-neutral-800 bg-neutral-950/45"
      actions={
        <span className="flex items-center gap-2">
          <span className="mr-1 text-xs text-neutral-500">
            {bindings.length} parameter{bindings.length === 1 ? "" : "s"}
          </span>
          <MomentaryFeedbackButton
            type="button"
            className="icon-link text-red-200"
            aria-label={`Remove ${group.label} and all of its parameters`}
            onClick={onRemoveAll}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      }
    >
      <div className="grid gap-3 p-3 text-sm">
        {group.description ? (
          <p className="text-xs text-neutral-500">{group.description}</p>
        ) : null}

        {bindings.map((binding) => renderMember(binding))}

        {missing.length ? (
          <ConfigSelect
            label={`Add ${group.label.toLowerCase()} parameter`}
            value=""
            options={[
              { value: "", label: "Add parameter…" },
              ...missing.map((member) => ({
                value: member.id,
                label: member.shortLabel ?? member.label,
                detail: member.description,
              })),
            ]}
            onChange={(effectId) => { if (effectId) onAdd(effectId); }}
          />
        ) : null}
      </div>
    </ConfigAccordion>
  );
}
