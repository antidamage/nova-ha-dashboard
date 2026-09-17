/**
 * Effect entry maths: the "When stacked" list, which optional parameters a
 * binding carries, and the values an entry derives from its binding before it
 * draws anything. Split out of `EffectEntry.tsx`
 * (specs/agent-token-footprint.md §4).
 */
import type {
  PhonoscopeCombineMode,
  PhonoscopeEffectBinding,
} from "../../../lib/types";
import {
  isPhonoscopeOverrideOnlyEffect,
  isPhonoscopeThemePulseEffect,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
} from "../../../lib/phonoscope-drivers";
import { PHONOSCOPE_PICTURE_EFFECTS } from "../../../lib/phonoscope-effects";
import type { EffectOption } from "./types";

/**
 * How several lanes setting the same value resolve against each other.
 *
 * Exported because a parameter group offers this once for all of its
 * parameters, so `EffectGroupEntry` draws the same list.
 */
export const COMBINE_OPTIONS = [
  { value: "add", label: "Sum", detail: "Every lane's contribution adds together." },
  {
    value: "strongest",
    label: "Least frequent lane wins",
    detail: "The rarest lane that is firing takes it outright.",
  },
  {
    value: "common",
    label: "Most frequent lane wins",
    detail: "The busiest lane that is firing takes it outright.",
  },
  {
    value: "override",
    label: "Override",
    detail: "The last settings group to set it replaces the value entirely.",
  },
];

/** The optional parameters an effect entry can carry, in the order offered. */
export type ParameterKey = "range" | "envelope" | "combine" | "order";

export function hasParameter(
  binding: PhonoscopeEffectBinding,
  combine: PhonoscopeCombineMode | undefined,
  key: ParameterKey,
) {
  switch (key) {
    case "range": return binding.min !== undefined || binding.max !== undefined;
    case "envelope":
      return binding.attackSeconds !== undefined || binding.holdSeconds !== undefined
        || binding.releaseSeconds !== undefined;
    case "combine": return combine !== undefined;
    case "order": return binding.params?.order !== undefined;
  }
}

const PARAMETER_KEYS: ParameterKey[] = ["range", "envelope", "combine", "order"];

export function pictureDeclaration(id: string) {
  return PHONOSCOPE_PICTURE_EFFECTS.find((effect) => effect.id === id);
}

/** Everything `EffectEntry` works out from its props before it renders. */
export type EffectEntryView = ReturnType<typeof effectEntryView>;

export function effectEntryView({
  binding,
  combine,
  companions,
  effect,
  variant,
}: {
  binding: PhonoscopeEffectBinding;
  combine: PhonoscopeCombineMode | undefined;
  companions?: PhonoscopeEffectBinding[];
  effect: EffectOption;
  variant: "card" | "row";
}) {
  const range: [number, number] = [
    binding.min ?? effect.min,
    binding.max ?? effect.max,
  ];
  const envelope: [number, number, number] = [
    binding.attackSeconds ?? 0.05,
    binding.holdSeconds ?? 0,
    binding.releaseSeconds ?? 0.6,
  ];
  // The rotation pulses are instructions: any non-zero contribution advances
  // the rotation by one entry, or flips the alt state, so the range is fixed at
  // 0-1 and there is nothing to author. The envelope is still the cross-fade,
  // which is why it is labelled "Transition" on both of them.
  const themePulse = isPhonoscopeThemePulseEffect(binding.effect);
  const fixedRange = themePulse;
  // An override-only axis has nothing to decide: it never stacks, so offering
  // "When stacked" would be offering a choice that is not taken.
  const overrideOnly = isPhonoscopeOverrideOnlyEffect(binding.effect);
  // The transition brings its own control set, which IS its parameters: there
  // is nothing left for the sparse "+ Add parameter" menu to offer.
  const controlSet = binding.effect === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
    || binding.effect === PHONOSCOPE_BG_TRANSITION_EFFECT;
  const companionValue = (effectId: string) => {
    const declaration = pictureDeclaration(effectId);
    let resolved = declaration?.default ?? 0;
    for (const entry of companions ?? []) {
      if (entry.effect !== effectId) continue;
      const value = entry.min ?? entry.max;
      if (typeof value === "number" && Number.isFinite(value)) resolved = value;
    }
    return resolved;
  };
  const missing = controlSet ? [] : PARAMETER_KEYS.filter((key) => {
    if (key === "order" && binding.effect !== PHONOSCOPE_THEME_CHANGE_EFFECT) return false;
    if (key === "range" && fixedRange) return false;
    if (key === "combine" && overrideOnly) return false;
    // A discrete axis cuts between modes, it never ramps, so an envelope on it
    // would only describe a shape it cannot take. A pinned axis is one value
    // held for a whole transition, which is the same story.
    if (key === "envelope" && (effect.choices || effect.toggle || effect.pinned)) return false;
    // Inside a parameter group the group owns the ramp and the stacking mode,
    // so there is nothing here to add.
    if ((key === "envelope" || key === "combine") && variant === "row") return false;
    return !hasParameter(binding, combine, key);
  });

  // Inside a parameter group the heading already carries the subject, so the
  // parameter reads as "Opacity" rather than "Glow opacity".
  const name = effect.shortLabel ?? effect.label;
  const valueText = (value: number) =>
    `${effect.step >= 1 ? Math.round(value) : value.toFixed(1)}${effect.unit ?? ""}`;

  return {
    range, envelope, themePulse, fixedRange, overrideOnly, controlSet,
    companionValue, missing, name, valueText,
  };
}
