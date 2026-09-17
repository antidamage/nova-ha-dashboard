"use client";

import type {
  PhonoscopeCombineMode,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { ConfigAccordion } from "../ConfigControls";
import { DriverStack } from "./DriverControls";
import { DriverLaneActions } from "./DriverLaneActions";
import { PasteIntoButton } from "./ClipboardControls";
import { reidBinding } from "./clipboard";
import { EffectEntry } from "./EffectEntry";
import { AddEffectControl } from "./AddEffectControl";
import { EffectGroupEntry } from "./EffectGroupEntry";
import { newId } from "./color-group-model";
import { transitionCompanionsFor, isCompanionEffect } from "./effect-choices";
import { effectOptionFor, newEffectBinding } from "./effect-catalogue-model";
import { laneLabel } from "./driver-labels";
import { laneCommands } from "./lane-commands";
import { laneQueries } from "./settings-group-model";
import type { EffectOption, ResolvedEffectGroup } from "./types";

/**
 * One driver lane of a settings group: its driver stack, its effects (lone or
 * grouped), and the controls that add, move, copy and remove them.
 *
 * Split out of `SettingsGroupCard` (specs/agent-token-footprint.md §4). The
 * handlers are the ones that closed over the card's props, now built by
 * `laneCommands` and `laneQueries`.
 */
export function DriverLaneCard({
  catalogue,
  effectGroups,
  group,
  hasImage,
  index,
  lane,
  onChange,
}: {
  catalogue: EffectOption[];
  effectGroups: ResolvedEffectGroup[];
  group: PhonoscopeSettingsGroup;
  hasImage: { centre: boolean; background: boolean };
  index: number;
  lane: PhonoscopeDriverLane;
  onChange: (group: PhonoscopeSettingsGroup, commit?: boolean) => void;
}) {
  const {
    updateLane, moveLane, setCompanion, setSharedRamp, setSharedCombine,
  } = laneCommands({ group, onChange });
  const {
    memberRelevance, visibleBindings, laneItems, optionFor,
  } = laneQueries({ catalogue, effectGroups, hasImage });

  const renderBinding = (
    lane: PhonoscopeDriverLane,
    binding: PhonoscopeEffectBinding,
    inGroup = false,
  ) => {
    // A companion has no entry of its own: the control set that owns it shows
    // it, and only under the mode that uses it.
    if (isCompanionEffect(binding.effect)) return null;
    const effect = optionFor(binding.effect);
    if (!effect) return null;
    // Only the companions of THIS transition: the centre's and the background's
    // are separate control sets, and removing one must not strip the other's.
    const owned = new Set(transitionCompanionsFor(binding.effect).map((entry) => entry.id));
    return (
      <EffectEntry
        key={binding.id}
        binding={binding}
        combine={group.combine[binding.effect]}
        companions={lane.bindings.filter((entry) => isCompanionEffect(entry.effect))}
        driver={lane.driver}
        effect={effect}
        variant={inGroup ? "row" : "card"}
        onCompanionChange={(effectId, value) => setCompanion(lane, effectId, value)}
        onChange={(next) => updateLane(lane.id, {
          bindings: lane.bindings.map((entry) => entry.id === next.id ? next : entry),
        })}
        onCombineChange={(mode: PhonoscopeCombineMode) => onChange({
          ...group,
          combine: { ...group.combine, [binding.effect]: mode },
        })}
        onCombineRemove={() => {
          // The combine mode is shared by every appearance of this effect, so
          // removing it here returns them all to the default rather than only
          // this binding.
          const combine = { ...group.combine };
          delete combine[binding.effect];
          onChange({ ...group, combine });
        }}
        onDuplicate={() => updateLane(lane.id, {
          bindings: lane.bindings.flatMap((entry) =>
            entry.id === binding.id ? [entry, reidBinding(entry)] : [entry]),
        })}
        onRemove={() => updateLane(lane.id, {
          bindings: lane.bindings.filter((entry) => entry.id !== binding.id
            // The companions have no control of their own, so leaving them
            // behind would leave values in the group that nothing can edit.
            && !owned.has(entry.effect)),
        })}
        onPaste={(pasted) => updateLane(lane.id, {
          bindings: lane.bindings.map((entry) => entry.id === binding.id
            // Keep this appearance's identity, take the copied settings. The
            // effect is guaranteed to match by `accepts` on the paste control.
            ? { ...pasted, id: entry.id }
            : entry),
        })}
      />
    );
  };

  return (
    <ConfigAccordion
      id={`lane-${lane.id}`}
      title={laneLabel(lane.driver, lane.modifiers)}
      className="border border-neutral-800 bg-neutral-950/45"
      actions={
        <DriverLaneActions
          group={group}
          index={index}
          lane={lane}
          moveLane={moveLane}
          onChange={onChange}
          visibleBindings={visibleBindings}
        />
      }
    >
      <div className="grid gap-3 p-3">
        <DriverStack
          driver={lane.driver}
          modifiers={lane.modifiers}
          onChange={(driver, modifiers) => updateLane(lane.id, { driver, modifiers })}
        />
        {laneItems(lane).map((item) => item.kind === "group" ? (
          <EffectGroupEntry
            key={`${lane.id}-${item.group.id}`}
            bindings={item.bindings}
            combine={group.combine}
            group={item.group}
            isMemberRelevant={memberRelevance(lane, item.group.id)}
            laneId={lane.id}
            onAdd={(effectId, [attackSeconds, holdSeconds, releaseSeconds]) => {
              const member = effectOptionFor(catalogue, effectId);
              if (!member) return;
              const added = newEffectBinding(newId("bind"), member);
              updateLane(lane.id, {
                bindings: [...lane.bindings, added.attackSeconds === undefined
                  // A discrete or pinned parameter takes no ramp at all.
                  ? added
                  : { ...added, attackSeconds, holdSeconds, releaseSeconds }],
              });
            }}
            onRemoveAll={() => {
              const members = new Set(item.group.members.map((member) => member.id));
              // Taking a transition away takes its companions with it:
              // they belong to its control set, not to the lane. Resolved
              // from the members actually in this group, so removing the
              // Centre group cannot strip the Background group's.
              const companions = new Set([...members]
                .flatMap((id) => transitionCompanionsFor(id))
                .map((companion) => companion.id));
              updateLane(lane.id, {
                bindings: lane.bindings.filter((entry) => !members.has(entry.effect)
                  && !companions.has(entry.effect)),
              });
            }}
            onSharedCombineChange={setSharedCombine}
            onSharedRampChange={(effectIds, ramp) => setSharedRamp(lane, effectIds, ramp)}
            renderMember={(binding) => renderBinding(lane, binding, true)}
          />
        ) : renderBinding(lane, item.binding))}
        <AddEffectControl
          catalogue={catalogue}
          groups={effectGroups}
          onAdd={(effectId) => {
            const added = effectOptionFor(catalogue, effectId);
            // Never twice in ONE lane: two bindings of one parameter just
            // fight over the same value, and the second is invisible
            // underneath the first. Across lanes is a different matter --
            // that is what stacking is for, and this guard is per lane.
            if (!added || lane.bindings.some((entry) => entry.effect === added.id)) return;
            updateLane(lane.id, {
              bindings: [...lane.bindings, newEffectBinding(newId("bind"), added)],
            });
          }}
          onAddGroup={(added) => {
            // Adding a group adds its first member, which is the one that
            // decides whether the group does anything: the rest are
            // parameters you then add to it.
            //
            // First member NOT ALREADY BOUND, because the group is still
            // offered once its parameters are on the lane -- adding Glow
            // over an existing Glow opacity used to bind a second copy of
            // it, and adding Grid did the same to whichever parameter
            // happened to be first.
            const bound = new Set(lane.bindings.map((entry) => entry.effect));
            const first = added.members.find((member) => !bound.has(member.id));
            if (!first) return;
            updateLane(lane.id, {
              bindings: [...lane.bindings, newEffectBinding(newId("bind"), first)],
            });
          }}
        />
        <PasteIntoButton
          kind="lane"
          what="driver lane"
          onPaste={(pasted) => updateLane(lane.id, {
            // The lane keeps its own id so its position and open state
            // survive; everything that describes it is replaced.
            driver: pasted.driver,
            modifiers: pasted.modifiers,
            bindings: pasted.bindings,
          })}
        />
      </div>
    </ConfigAccordion>
  );
}
