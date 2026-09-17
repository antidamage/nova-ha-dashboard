"use client";

import { Plus, Trash2 } from "lucide-react";
import type { PhonoscopeSettingsGroup } from "../../../lib/types";
import { phonoscopeDriver } from "../../../lib/phonoscope-drivers";
import { ConfigAccordion, SliderControlPanel } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { SoloButton } from "./SoloControls";
import { useEditLock } from "./editing-lock";
import { DriverLaneCard } from "./DriverLaneCard";
import { newId } from "./color-group-model";
import { unusedDriverType } from "./settings-group-model";
import type { EffectOption, ModuleSetting, ResolvedEffectGroup } from "./types";

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
  hasImage,
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
  /**
   * Whether any colour theme names an image in each slot.
   *
   * A household fact rather than a per-group one: settings groups and colour
   * themes are chosen independently by a rotation entry, so there is no "this
   * group's theme" to ask. If ANY theme can put an image in a slot, that slot's
   * size mode is worth offering here; if none can, it could never do anything
   * and the card hides it.
   */
  hasImage: { centre: boolean; background: boolean };
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
  // Holds the panel's state still while the name is being typed into, so a
  // save's reply cannot rewrite the field mid-rename.
  const editLock = useEditLock();

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
            onFocus={editLock.onFocus}
            onBlur={() => {
              // Release before committing: the commit's reply is the one echo
              // that SHOULD land on this field, because it carries the finished
              // name.
              editLock.onBlur();
              onChange(group, true);
            }}
          />
        </label>

        {staticSettings.map((setting) => {
          const value = group.staticSettings[setting.id] ?? setting.default;
          return (
            <div key={setting.id} className="grid gap-1">
              <SliderControlPanel
                ariaLabel={setting.label}
                ariaValueText={String(value)}
                snapRemote
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
                Static: cannot be driven, and changing it rebuilds the scene.
              </span>
            </div>
          );
        })}

        {group.lanes.map((lane, index) => (
          <DriverLaneCard
            key={lane.id}
            catalogue={catalogue}
            effectGroups={effectGroups}
            group={group}
            hasImage={hasImage}
            index={index}
            lane={lane}
            onChange={onChange}
          />
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
            One driver and the effects it runs.
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
