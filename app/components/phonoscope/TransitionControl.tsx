"use client";

import type { PhonoscopeEffectBinding } from "../../../lib/types";
import {
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
} from "../../../lib/phonoscope-drivers";
import { PHONOSCOPE_PICTURE_EFFECT_LABELS } from "../../../lib/phonoscope-effects";
import { ConfigSelect } from "../ConfigSelect";
import { EnvelopeSliderControlPanel, SliderControlPanel } from "../ConfigControls";
import { SwitchRow } from "../SlideSwitch";
import { IMAGE_TRANSITION_CHOICES, transitionCompanionsFor } from "./effect-choices";
import { pictureDeclaration } from "./effect-entry-model";

/**
 * A transition as one control set rather than four effects.
 *
 * Used by both the centre slot and the background image, which have identical
 * modes and identical companions on separate axes — so this takes the mode
 * binding it was handed and looks its companions up from it, rather than naming
 * the centre's.
 *
 * The mode decides what the rest of the set even means, so the set follows the
 * mode: a cross-fade shows nothing but its ramp, a flip adds the axis it
 * collapses along, and a slide adds the divisions and which edge the pieces
 * come back from. An axis slider sitting under a cross-fade would be a control
 * that does nothing, and the user would have had to know that.
 *
 * The ramp is always shown because every transition has one — it is the
 * transition's own motion, not a parameter of one of its modes. On a one-shot
 * transition the three phases read as attack = ease-in, hold = flat, release =
 * ease-out, and the transition lasts exactly their sum.
 *
 * Underneath, each row is still its own effect id with its own binding, so the
 * override resolution, both engines and the conformance corpus are untouched:
 * this is entirely how it is presented and written.
 *
 * Split out of `EffectEntry.tsx` (specs/agent-token-footprint.md §4).
 */
export function TransitionControl({
  binding,
  companionValue,
  envelope,
  onChange,
  onCompanionChange,
}: {
  binding: PhonoscopeEffectBinding;
  companionValue: (effect: string) => number;
  envelope: [number, number, number];
  onChange: (binding: PhonoscopeEffectBinding) => void;
  onCompanionChange: (effect: string, value: number) => void;
}) {
  const mode = Math.round(binding.min ?? binding.max ?? 0);
  const companions = transitionCompanionsFor(binding.effect);
  return (
    <div className="grid gap-3">
      <ConfigSelect
        label="Transition"
        value={String(mode)}
        options={IMAGE_TRANSITION_CHOICES.map((choice) => ({
          value: String(choice.value),
          label: choice.label,
        }))}
        onChange={(value) =>
          onChange({ ...binding, min: Number(value), max: Number(value) })}
      />

      {companions.filter((companion) => mode >= companion.minimumMode)
        .map((companion) => {
          const declaration = pictureDeclaration(companion.id);
          if (!declaration) return null;
          const labels = PHONOSCOPE_PICTURE_EFFECT_LABELS[companion.id];
          const label = labels?.shortLabel ?? labels?.label ?? companion.id;
          const value = companionValue(companion.id);
          if (companion.id === PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT
            || companion.id === PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT) {
            return (
              <SwitchRow
                key={companion.id}
                checked={value >= 0.5}
                detail={labels?.description}
                label={label}
                onChange={(checked) => onCompanionChange(companion.id, checked ? 1 : 0)}
              />
            );
          }
          const degrees = companion.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT
            || companion.id === PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT;
          return (
            <SliderControlPanel
              key={companion.id}
              ariaLabel={label}
              ariaValueText={String(Math.round(value))}
              snapRemote
              color={[34, 211, 238]}
              label={label}
              min={declaration.min}
              max={declaration.max}
              step={declaration.step}
              value={value}
              valueText={`${Math.round(value)}${degrees ? "°" : ""}`}
              onPreview={(next) => onCompanionChange(companion.id, next)}
              onCommit={(next) => onCompanionChange(companion.id, next)}
            />
          );
        })}

      <EnvelopeSliderControlPanel
        ariaLabel="Transition ramp"
        label="Ramp"
        value={envelope}
        onPreview={([attackSeconds, holdSeconds, releaseSeconds]) =>
          onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
        onCommit={([attackSeconds, holdSeconds, releaseSeconds]) =>
          onChange({ ...binding, attackSeconds, holdSeconds, releaseSeconds })}
      />
    </div>
  );
}
