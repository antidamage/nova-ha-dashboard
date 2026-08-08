"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PhonoscopeCombineMode, PhonoscopeEffectBinding } from "../../../lib/types";
import { isPhonoscopeOverrideOnlyEffect } from "../../../lib/phonoscope-drivers";
import { ConfigSelect } from "../ConfigSelect";
import { ConfigAccordion, EnvelopeSliderControlPanel } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { COMBINE_OPTIONS } from "./EffectEntry";
import type { ResolvedEffectGroup, ResolvedParameterGroup } from "./effectCatalogue";

/** The ramp a parameter group falls back to before anything has authored one. */
const DEFAULT_RAMP: [number, number, number] = [0.05, 0, 0.6];

/**
 * One appearance of an effect inside a lane — Centre image, Background image,
 * Glow, Grid.
 *
 * An effect is one thing you add. Inside it, parameters live in PARAMETER
 * GROUPS: Size holds the width, the height and the scale together, Transition
 * holds the mode and the axes it uses. A parameter group is a labelled block of
 * controls, deliberately not a fourth level of accordion — the panel is already
 * three deep before it gets here — and it carries ONE ramp for all of its
 * parameters, never a ramp per parameter.
 *
 * It owns no state of its own: each parameter is still an ordinary binding, and
 * this only decides which of them are on screen and under which heading.
 *
 * Removing the effect removes every parameter binding in this lane, because an
 * empty effect is not a state the picker can produce — you would have to add it
 * again to get anything back.
 */
export function EffectGroupEntry({
  bindings,
  combine,
  group,
  isMemberRelevant,
  laneId,
  onAdd,
  onRemoveAll,
  onSharedCombineChange,
  onSharedRampChange,
  renderMember,
}: {
  /** This lane's bindings for parameters of this effect, in the lane's order. */
  bindings: PhonoscopeEffectBinding[];
  /** The settings group's stacking modes, keyed by effect id. */
  combine: Record<string, PhonoscopeCombineMode>;
  group: ResolvedEffectGroup;
  /**
   * False for a parameter that cannot do anything as things stand — a manual
   * width while the background's size mode is Fit, a size mode at all while no
   * colour theme names a background image.
   *
   * It hides the control AND withholds it from the "Add parameter" menu,
   * because those are the same statement: a control that cannot affect the
   * picture is not one to offer. Nothing is deleted — an irrelevant binding
   * keeps its stored value and comes back when the mode that uses it does.
   */
  isMemberRelevant?: (effectId: string) => boolean;
  laneId: string;
  onAdd: (effectId: string, ramp: [number, number, number]) => void;
  onRemoveAll: () => void;
  /** Write the group's one stacking mode across every parameter that stacks. */
  onSharedCombineChange: (effectIds: string[], mode: PhonoscopeCombineMode) => void;
  /** Write the group's one ramp across every continuous parameter in it. */
  onSharedRampChange: (effectIds: string[], ramp: [number, number, number]) => void;
  renderMember: (binding: PhonoscopeEffectBinding, parameters: ResolvedParameterGroup) => ReactNode;
}) {
  const relevant = (effectId: string) => isMemberRelevant?.(effectId) ?? true;
  const shown = bindings.filter((binding) => relevant(binding.effect));
  const bound = new Set(bindings.map((binding) => binding.effect));

  return (
    <ConfigAccordion
      id={`effect-group-${laneId}-${group.id}`}
      title={group.label}
      className="border border-neutral-800 bg-neutral-950/45"
      actions={
        <span className="flex items-center gap-2">
          <span className="mr-1 text-xs text-neutral-500">
            {shown.length} parameter{shown.length === 1 ? "" : "s"}
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
        {group.parameterGroups.map((parameters) => (
          <ParameterGroupSection
            key={parameters.id}
            bindings={shown}
            bound={bound}
            combine={combine}
            parameters={parameters}
            relevant={relevant}
            onAdd={onAdd}
            onSharedCombineChange={onSharedCombineChange}
            onSharedRampChange={onSharedRampChange}
            renderMember={renderMember}
          />
        ))}
      </div>
    </ConfigAccordion>
  );
}

/**
 * One parameter group: its controls, the single ramp that runs all of them, and
 * the menu to add the ones not on yet.
 *
 * A parameter group with nothing in it and nothing left to offer is not drawn
 * at all: it would be a heading over an empty box.
 */
function ParameterGroupSection({
  bindings,
  bound,
  combine,
  parameters,
  relevant,
  onAdd,
  onSharedCombineChange,
  onSharedRampChange,
  renderMember,
}: {
  bindings: PhonoscopeEffectBinding[];
  bound: Set<string>;
  combine: Record<string, PhonoscopeCombineMode>;
  parameters: ResolvedParameterGroup;
  relevant: (effectId: string) => boolean;
  onAdd: (effectId: string, ramp: [number, number, number]) => void;
  onSharedCombineChange: (effectIds: string[], mode: PhonoscopeCombineMode) => void;
  onSharedRampChange: (effectIds: string[], ramp: [number, number, number]) => void;
  renderMember: (binding: PhonoscopeEffectBinding, parameters: ResolvedParameterGroup) => ReactNode;
}) {
  const ours = new Set(parameters.members.map((member) => member.id));
  const shown = bindings.filter((binding) => ours.has(binding.effect));
  // A parameter already in this lane is not offered again. Adding the same one
  // twice is legal — two appearances stack — but it is a deliberate act, and
  // the way to do it stays the duplicate action on the parameter itself.
  const missing = parameters.members.filter((member) =>
    !bound.has(member.id) && relevant(member.id));

  // Every parameter group has exactly one ramp. A discrete or pinned parameter
  // cuts rather than ramping, so the group's ramp is the ramp of everything in
  // it that can actually take one — and a group with none of those (a
  // transition, whose control set carries its own motion profile) shows none
  // here rather than a second one.
  const ramped = parameters.members.filter((member) =>
    !member.choices && !member.toggle && !member.pinned);
  const rampable = new Set(ramped.map((member) => member.id));
  const carrying = shown.find((binding) => rampable.has(binding.effect)
    && binding.attackSeconds !== undefined);
  const ramp: [number, number, number] = carrying
    ? [
        carrying.attackSeconds ?? DEFAULT_RAMP[0],
        carrying.holdSeconds ?? DEFAULT_RAMP[1],
        carrying.releaseSeconds ?? DEFAULT_RAMP[2],
      ]
    : DEFAULT_RAMP;
  const showRamp = shown.some((binding) => rampable.has(binding.effect));

  // Stacking is one decision for the whole group, on the same footing as the
  // ramp: the parameters of a group describe one thing, so how two lanes
  // setting it resolve is a property of that thing rather than of each slider.
  // An override-only axis never stacks, so it is simply not part of it.
  const stacking = new Set(parameters.members
    .filter((member) => !isPhonoscopeOverrideOnlyEffect(member.id))
    .map((member) => member.id));
  const showCombine = shown.some((binding) => stacking.has(binding.effect));
  const mode = parameters.members
    .map((member) => stacking.has(member.id) ? combine[member.id] : undefined)
    .find((entry) => entry !== undefined) ?? "add";

  if (!shown.length && !missing.length) return null;

  return (
    <div
      className="grid gap-3 rounded border border-neutral-800/80 bg-neutral-950/40 p-3"
      data-parameter-group={parameters.id}
    >
      <span className="text-xs font-black uppercase text-neutral-400">{parameters.label}</span>

      {shown.map((binding) => renderMember(binding, parameters))}

      {showRamp ? (
        <EnvelopeSliderControlPanel
          ariaLabel={`${parameters.label} ramp`}
          label="Ramp"
          value={ramp}
          onPreview={(next) => onSharedRampChange([...rampable], next)}
          onCommit={(next) => onSharedRampChange([...rampable], next)}
        />
      ) : null}

      {showCombine ? (
        <ConfigSelect
          label="When stacked"
          value={mode}
          options={COMBINE_OPTIONS}
          // Written to every parameter of the group, bound or not, so one that
          // is added later already stacks the way the group does.
          onChange={(next) => onSharedCombineChange([...stacking], next as PhonoscopeCombineMode)}
        />
      ) : null}

      {missing.length ? (
        <ConfigSelect
          label={`Add ${parameters.label.toLowerCase()} parameter`}
          value=""
          options={[
            { value: "", label: "Add parameter…" },
            ...missing.map((member) => ({
              value: member.id,
              label: member.shortLabel ?? member.label,
            })),
          ]}
          // A parameter joining the group joins its ramp too, so the one ramp
          // is true the moment it lands rather than after the next edit of it.
          onChange={(effectId) => { if (effectId) onAdd(effectId, ramp); }}
        />
      ) : null}
    </div>
  );
}
