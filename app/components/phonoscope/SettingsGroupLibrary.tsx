"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriverLane,
  PhonoscopeDriverType,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "../../../lib/types";
import { phonoscopeDriver } from "../../../lib/phonoscope-drivers";
import { ConfigAccordion, SliderControlPanel } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { DriverStack } from "./DriverControls";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { SoloButton } from "./SoloControls";
import { reidBinding, reidLane } from "./clipboard";
import { AddEffectControl, EffectEntry } from "./EffectEntry";
import { EffectGroupEntry } from "./EffectGroupEntry";
import {
  effectGroupIndex,
  effectOptionFor,
  laneLabel,
  newEffectBinding,
  type EffectOption,
  type ModuleSetting,
  type ResolvedEffectGroup,
} from "./effectCatalogue";

/** One row in a lane: either a lone effect, or a group with its parameters. */
type LaneItem =
  | { kind: "binding"; binding: PhonoscopeEffectBinding }
  | { kind: "group"; group: ResolvedEffectGroup; bindings: PhonoscopeEffectBinding[] };

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** The first driver this group has no lane for, so new lanes read distinctly. */
export function unusedDriverType(lanes: PhonoscopeDriverLane[]): PhonoscopeDriverType {
  const taken = new Set(lanes.map((lane) => lane.driver.type));
  return NEW_LANE_ORDER.find((type) => !taken.has(type)) ?? "beat";
}

const NEW_LANE_ORDER: PhonoscopeDriverType[] = [
  "beat", "downbeat", "bass", "mid", "treble", "energy", "song", "timer", "random",
];

/**
 * One settings group: its static parameters, then its driver lanes.
 *
 * Nesting `ConfigAccordion` is deliberate. Its exclusive-siblings behaviour is
 * scoped to the nearest ancestor, so group → lane → effect each get "opening
 * one closes the others" for free, at every level, with no extra state.
 */
export function SettingsGroupCard({
  catalogue,
  effectGroups,
  group,
  onChange,
  onDuplicate,
  onRemove,
  onSolo,
  soloed,
  staticSettings,
}: {
  catalogue: EffectOption[];
  /** Related effects offered as one entry, with their members as parameters. */
  effectGroups: ResolvedEffectGroup[];
  group: PhonoscopeSettingsGroup;
  /** `commit` false while typing, so a rename does not write per keystroke. */
  onChange: (group: PhonoscopeSettingsGroup, commit?: boolean) => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  /** True when this group is the one the visualiser is held on. */
  soloed: boolean;
  onSolo: () => void;
  /** The module's undriveable settings, edited directly on the group. */
  staticSettings: ModuleSetting[];
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

  const groupOf = effectGroupIndex(effectGroups);

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
    return lane.bindings.flatMap<LaneItem>((binding) => {
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

  const renderBinding = (lane: PhonoscopeDriverLane, binding: PhonoscopeEffectBinding) => {
    const effect = optionFor(binding.effect);
    if (!effect) return null;
    return (
      <EffectEntry
        key={binding.id}
        binding={binding}
        combine={group.combine[binding.effect]}
        driver={lane.driver}
        effect={effect}
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
          bindings: lane.bindings.filter((entry) => entry.id !== binding.id),
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
      id={`settings-group-${group.id}`}
      title={group.name}
      className="border border-neutral-800 bg-neutral-950/30"
      actions={
        <span className="flex items-center gap-2">
          {group.isDefault ? (
            <span className="text-xs font-black uppercase text-cyan-300">Default</span>
          ) : null}
          <SoloButton active={soloed} label={group.name} onToggle={onSolo} />
          {onDuplicate ? (
            <CopyActions
              kind="settingsGroup"
              label={group.name}
              payload={group}
              onDuplicate={onDuplicate}
            />
          ) : null}
          {onRemove && !group.isDefault ? (
            <MomentaryFeedbackButton
              type="button"
              className="icon-link text-red-200"
              aria-label={`Delete ${group.name}`}
              onClick={onRemove}
            >
              <Trash2 className="h-4 w-4" />
            </MomentaryFeedbackButton>
          ) : null}
        </span>
      }
    >
      <div className="grid gap-3 p-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-black uppercase text-neutral-400">Name</span>
          <input
            className="cyber-text-input"
            value={group.name}
            onChange={(event) => onChange({ ...group, name: event.target.value }, false)}
            onBlur={() => onChange(group, true)}
          />
        </label>

        {staticSettings.map((setting) => {
          const value = group.staticSettings[setting.id] ?? setting.default;
          return (
            <div key={setting.id} className="grid gap-1">
              <SliderControlPanel
                ariaLabel={setting.label}
                ariaValueText={String(value)}
                color={[34, 211, 238]}
                label={setting.label}
                min={setting.min}
                max={setting.max}
                step={setting.step}
                value={value}
                valueText={value.toFixed(setting.step >= 1 ? 0 : 2)}
                onPreview={(next) => onChange({
                  ...group,
                  staticSettings: { ...group.staticSettings, [setting.id]: next },
                })}
                onCommit={(next) => onChange({
                  ...group,
                  staticSettings: { ...group.staticSettings, [setting.id]: next },
                })}
              />
              <span className="text-xs text-neutral-500">
                Static: this cannot be driven, and changing it rebuilds the scene. Two settings
                groups that disagree on it will snap when the playlist moves between them.
              </span>
            </div>
          );
        })}

        {group.lanes.map((lane, index) => (
          <ConfigAccordion
            key={lane.id}
            id={`lane-${lane.id}`}
            title={laneLabel(lane.driver, lane.modifiers)}
            className="border border-neutral-800 bg-neutral-950/45"
            actions={
              <span className="flex items-center gap-1">
                <span className="mr-2 text-xs text-neutral-500">
                  {lane.bindings.length} effect{lane.bindings.length === 1 ? "" : "s"}
                </span>
                <CopyActions
                  kind="lane"
                  label={laneLabel(lane.driver, lane.modifiers)}
                  payload={lane}
                  onDuplicate={() => onChange({
                    ...group,
                    lanes: [
                      ...group.lanes.slice(0, index + 1),
                      reidLane(lane),
                      ...group.lanes.slice(index + 1),
                    ],
                  })}
                />
                <MomentaryFeedbackButton
                  type="button" className="icon-link" aria-label="Move lane earlier"
                  disabled={index === 0} onClick={() => moveLane(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </MomentaryFeedbackButton>
                <MomentaryFeedbackButton
                  type="button" className="icon-link" aria-label="Move lane later"
                  disabled={index === group.lanes.length - 1} onClick={() => moveLane(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </MomentaryFeedbackButton>
                <MomentaryFeedbackButton
                  type="button" className="icon-link text-red-200" aria-label="Remove lane"
                  onClick={() => onChange({
                    ...group,
                    lanes: group.lanes.filter((entry) => entry.id !== lane.id),
                  })}
                >
                  <Trash2 className="h-4 w-4" />
                </MomentaryFeedbackButton>
              </span>
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
                  group={item.group}
                  laneId={lane.id}
                  onAdd={(effectId) => {
                    const member = effectOptionFor(catalogue, effectId);
                    if (!member) return;
                    updateLane(lane.id, {
                      bindings: [...lane.bindings, newEffectBinding(newId("bind"), member)],
                    });
                  }}
                  onRemoveAll={() => {
                    const members = new Set(item.group.members.map((member) => member.id));
                    updateLane(lane.id, {
                      bindings: lane.bindings.filter((entry) => !members.has(entry.effect)),
                    });
                  }}
                  renderMember={(binding) => renderBinding(lane, binding)}
                />
              ) : renderBinding(lane, item.binding))}
              <AddEffectControl
                catalogue={catalogue}
                groups={effectGroups}
                onAdd={(effectId) => {
                  const added = effectOptionFor(catalogue, effectId);
                  if (!added) return;
                  updateLane(lane.id, {
                    bindings: [...lane.bindings, newEffectBinding(newId("bind"), added)],
                  });
                }}
                onAddGroup={(added) => {
                  // Adding a group adds its first member, which is the one that
                  // decides whether the group does anything: the rest are
                  // parameters you then add to it.
                  const first = added.members[0];
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
        ))}

        <div className="grid gap-1">
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button justify-center"
            onClick={() => onChange({
              ...group,
              lanes: [...group.lanes, {
                id: newId("lane"),
                // Default to a driver this group is not already running, so a
                // new lane is distinguishable from the existing ones at a
                // glance instead of arriving as a second identically-titled row.
                driver: phonoscopeDriver({ type: unusedDriverType(group.lanes) }),
                modifiers: [],
                bindings: [],
              }],
            })}
          >
            <Plus className="h-5 w-5" />
            Add driver lane
          </MomentaryFeedbackButton>
          <span className="text-xs text-neutral-500">
            A lane is one driver and the effects it runs. Add a lane to drive a different set
            of effects; to make this lane react to a second driver as well, use
            &ldquo;Combine with another driver&rdquo; inside it.
          </span>
        </div>
        <PasteIntoButton
          kind="settingsGroup"
          what="settings group"
          onPaste={(pasted) => onChange({
            ...group,
            // Name, id and the default flag stay with this group; the behaviour
            // is what is replaced.
            lanes: pasted.lanes,
            combine: pasted.combine,
            staticSettings: pasted.staticSettings,
          })}
        />
      </div>
    </ConfigAccordion>
  );
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
