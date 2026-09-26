"use client";

import { ConfigSelect } from "../../ConfigSelect";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ArrivalState } from "../../../../lib/config-schema/arrivals";
import type { ArrivalEventKind } from "../../../../lib/arrivals/types";
import {
  firstAvailableState,
  presetLabel,
  type ArrivalPresets,
  type ArrivalTargetOption,
} from "./arrival-config-model";

/**
 * One member's states for one event: a target, a preset, and a Remove. The
 * preset picker is the config's own listbox, and Add state only ever offers a
 * state that exists (a presetId the schema would refuse would be a save that
 * cannot succeed).
 */
export function StateList({
  event,
  onAdd,
  onRemove,
  onUpdate,
  presets,
  states,
  targets,
}: {
  event: ArrivalEventKind;
  onAdd: (state: ArrivalState) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, state: ArrivalState) => void;
  presets: ArrivalPresets;
  states: readonly ArrivalState[];
  targets: readonly ArrivalTargetOption[];
}) {
  const label = event === "arrival" ? "Arrival" : "Departure";
  // Only a target that HAS a preset can be chosen: a state's presetId is
  // required, so offering a target with an empty list would be a save that
  // cannot succeed. Same rule as Add state, for the same reason.
  const targetOptions = targets
    .filter((target) => (presets[target.kind] ?? []).length > 0)
    .map((target) => ({ value: target.kind, label: target.label }));
  const addable = firstAvailableState(targets, presets);

  return (
    <div className="grid gap-2">
      <p className="text-xs font-bold uppercase text-neutral-400">{label}</p>
      {states.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing is set for {event}.</p>
      ) : null}
      {states.map((state, index) => {
        const options = (presets[state.target] ?? []).map((preset) => ({
          value: preset.id,
          label: preset.label,
          group: preset.group,
        }));
        // A row whose target has no presets is only reachable through a
        // hand-edited config, so keep it selectable in the list to stay visible
        // and removable rather than silently reading as some other target.
        const rowTargetOptions = targetOptions.some((option) => option.value === state.target)
          ? targetOptions
          : [
              ...targetOptions,
              {
                value: state.target,
                label: `${targets.find((target) => target.kind === state.target)?.label ?? state.target} — no presets yet`,
              },
            ];
        return (
          <div key={`${state.target}-${state.presetId}-${index}`} className="flex items-center gap-2">
            <ConfigSelect
              ariaLabel={`${label} target`}
              onChange={(target) => {
                const preset = presets[target]?.[0];
                if (!preset) return;
                onUpdate(index, { target: target as ArrivalState["target"], presetId: preset.id });
              }}
              options={rowTargetOptions}
              value={state.target}
            />
            <ConfigSelect
              ariaLabel={`${label} preset`}
              disabled={options.length === 0}
              onChange={(presetId) => onUpdate(index, { target: state.target, presetId })}
              options={options.length ? options : [{ value: state.presetId, label: presetLabel(presets, state) }]}
              value={state.presetId}
            />
            <MomentaryFeedbackButton aria-label={`Remove ${label.toLowerCase()} state`} onClick={() => onRemove(index)}>
              Remove
            </MomentaryFeedbackButton>
          </div>
        );
      })}
      <MomentaryFeedbackButton
        aria-label={`Add ${event} state`}
        disabled={!addable}
        onClick={() => {
          if (addable) onAdd(addable);
        }}
      >
        Add {event} state
      </MomentaryFeedbackButton>
      {addable ? null : (
        <p className="text-sm text-neutral-500">No presets are available yet, so there is nothing to add.</p>
      )}
    </div>
  );
}
