"use client";

import { Trash2, X } from "lucide-react";
import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeEffectBinding,
} from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { ConfigAccordion } from "../ConfigControls";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import type { EffectOption } from "./types";
import { CopyActions, PasteIntoButton } from "./ClipboardControls";
import { effectEntryView, type ParameterKey } from "./effect-entry-model";
import { EffectEntryControls } from "./EffectEntryControls";

// Where the rest of this file went (specs/agent-token-footprint.md §4):
//
//   effect-entry-model.ts     COMBINE_OPTIONS, the parameter keys, the derived view
//   EffectEntryControls.tsx   the parameter controls and their remove buttons
//   TransitionControl.tsx     the transition control set
//   PlaybackOrderControl.tsx  the playlist order radio group
//   AddEffectControl.tsx      the "+ Add effect" picker
export { COMBINE_OPTIONS } from "./effect-entry-model";
export { AddEffectControl, addEffectIcon } from "./AddEffectControl";

/**
 * One appearance of an effect inside a lane.
 *
 * Collapsed it is just the name. Expanded it shows only the parameters that
 * have been added — everything else inherits the effect's declared default, so
 * a binding stores what the user actually chose and nothing more.
 */
export function EffectEntry({
  binding,
  combine,
  companions,
  driver,
  effect,
  onChange,
  onCombineChange,
  onCombineRemove,
  onCompanionChange,
  onDuplicate,
  onPaste,
  onRemove,
  variant = "card",
}: {
  binding: PhonoscopeEffectBinding;
  /** Shared by every appearance of this effect, so it is edited via the group. */
  combine: PhonoscopeCombineMode | undefined;
  /** Bindings elsewhere in the lane that this effect's control set owns. */
  companions?: PhonoscopeEffectBinding[];
  driver: PhonoscopeDriver;
  effect: EffectOption;
  onChange: (binding: PhonoscopeEffectBinding) => void;
  /** Set one of those companion values, creating its binding if there is none. */
  onCompanionChange?: (effect: string, value: number) => void;
  onCombineChange: (mode: PhonoscopeCombineMode) => void;
  onCombineRemove: () => void;
  onDuplicate: () => void;
  onPaste: (binding: PhonoscopeEffectBinding) => void;
  onRemove: () => void;
  /**
   * `card` is an effect standing on its own in a lane: a collapsible with its
   * clipboard actions and its sparse "+ Add parameter" menu.
   *
   * `row` is one parameter inside a parameter group, where the group already
   * carries the subject and the accordion chrome. It renders the control and
   * the button that takes it back off — a fourth level of accordion would be
   * unusable — and never a ramp or a "When stacked": the group owns one of each
   * for all of its parameters and writes the same value to every member, so
   * either here would be a second control for the same decision.
   */
  variant?: "card" | "row";
}) {
  const view = effectEntryView({ binding, combine, companions, effect, variant });
  const { themePulse, missing, name } = view;

  const removeParameter = (key: ParameterKey) => {
    if (key === "combine") {
      onCombineRemove();
      return;
    }
    const next = { ...binding };
    if (key === "range") {
      delete next.min;
      delete next.max;
      // The RND tag belongs to the range, not to itself: with no range to draw
      // from there is nothing for it to mean.
      delete next.randomValue;
    } else if (key === "envelope") {
      delete next.attackSeconds;
      delete next.holdSeconds;
      delete next.releaseSeconds;
    } else {
      const params = { ...(next.params ?? {}) };
      delete params.order;
      // An empty params object would persist as a parameter that is not set.
      if (Object.keys(params).length) next.params = params;
      else delete next.params;
    }
    onChange(next);
  };

  const addParameter = (key: ParameterKey) => {
    if (key === "combine") {
      onCombineChange("add");
      return;
    }
    if (key === "range") {
      // A discrete or pinned axis starts as a fixed choice — both ends on the
      // default — so adding it picks a value rather than sweeping the axis.
      if (effect.choices || effect.toggle || effect.pinned) {
        onChange({ ...binding, min: effect.default, max: effect.default });
        return;
      }
      onChange({ ...binding, min: effect.min, max: effect.max });
      return;
    }
    if (key === "envelope") {
      onChange({ ...binding, attackSeconds: 0.05, holdSeconds: 0, releaseSeconds: 0.6 });
      return;
    }
    onChange({ ...binding, params: { ...(binding.params ?? {}), order: 0 } });
  };

  const controls = (
    <EffectEntryControls
      binding={binding}
      combine={combine}
      driver={driver}
      effect={effect}
      onChange={onChange}
      onCombineChange={onCombineChange}
      onCompanionChange={onCompanionChange}
      removeParameter={removeParameter}
      variant={variant}
      view={view}
    />
  );

  if (variant === "row") {
    return (
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3">{controls}</div>
        <MomentaryFeedbackButton
          type="button"
          className="icon-link text-red-200"
          aria-label={`Remove ${effect.label}`}
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </MomentaryFeedbackButton>
      </div>
    );
  }

  return (
    <ConfigAccordion
      id={`effect-${binding.id}`}
      title={name}
      className="border border-neutral-800 bg-neutral-950/45"
      actions={
        <span className="flex items-center gap-2">
          <CopyActions
            kind="binding"
            label={effect.label}
            payload={binding}
            onDuplicate={onDuplicate}
          />
          <MomentaryFeedbackButton
            type="button"
            className="icon-link text-red-200"
            aria-label={`Remove ${effect.label}`}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </MomentaryFeedbackButton>
        </span>
      }
    >
      <div className="grid gap-3 p-3 text-sm">
        {controls}

        <PasteIntoButton
          kind="binding"
          what={effect.label}
          // Only another appearance of the same effect: a range and envelope
          // authored for one setting mean nothing on a different one.
          accepts={(pasted) => pasted.effect === binding.effect}
          onPaste={onPaste}
        />

        {missing.length ? (
          <ConfigSelect
            label="Add parameter"
            value=""
            options={[
              { value: "", label: "Add parameter…" },
              ...missing.map((key) => ({
                value: key,
                label: key === "range"
                  ? (effect.choices || effect.toggle || effect.pinned ? effect.label : "Range")
                  : key === "envelope"
                    ? (themePulse ? "Transition" : "Envelope")
                    : key === "combine" ? "When stacked" : "Playback",
              })),
            ]}
            onChange={(key) => { if (key) addParameter(key as ParameterKey); }}
          />
        ) : null}
      </div>
    </ConfigAccordion>
  );
}
