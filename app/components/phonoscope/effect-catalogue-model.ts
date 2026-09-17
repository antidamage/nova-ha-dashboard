/**
 * Building the effect catalogue for one module: every effect a settings group
 * can bind, and the binding a newly added one arrives with. Split out of
 * `effectCatalogue.ts` (specs/agent-token-footprint.md §4).
 */
import type { PhonoscopeEffectBinding } from "../../../lib/types";
import {
  PHONOSCOPE_PICTURE_EFFECTS,
  PHONOSCOPE_PICTURE_EFFECT_LABELS,
} from "../../../lib/phonoscope-effects";
import { PHONOSCOPE_SINGLE_VALUE_EFFECTS } from "../../../lib/phonoscope-effect-groups";
import {
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
  isPhonoscopeThemePulseEffect,
} from "../../../lib/phonoscope-drivers";
import {
  GLOW_BLEND_CHOICES,
  IMAGE_FIT_CHOICES,
  IMAGE_TRANSITION_CHOICES,
  PICTURE_SECTION,
  SCENE_BLEND_CHOICES,
  isCompanionEffect,
} from "./effect-choices";
import type { EffectOption, ModuleSetting } from "./types";

function titleCase(value: string) {
  const cleaned = value.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "General";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Every effect a settings group can bind for this module: the picture-level
 * ones plus the module's own driveable settings. Structural settings are
 * excluded — they rebuild the scene and are edited directly on the group.
 */
export function effectCatalogue(moduleSettings: ModuleSetting[]): EffectOption[] {
  const picture = PHONOSCOPE_PICTURE_EFFECTS.map((effect) => ({
    id: effect.id,
    label: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.label ?? effect.id,
    shortLabel: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.shortLabel,
    description: PHONOSCOPE_PICTURE_EFFECT_LABELS[effect.id]?.description,
    section: PICTURE_SECTION,
    min: effect.min,
    max: effect.max,
    step: effect.step,
    default: effect.default,
    choices:
      effect.id === PHONOSCOPE_GLOW_BLEND_EFFECT
        ? GLOW_BLEND_CHOICES
        : effect.id === PHONOSCOPE_SCENE_BLEND_EFFECT
          ? SCENE_BLEND_CHOICES
          : effect.id === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
            || effect.id === PHONOSCOPE_BG_TRANSITION_EFFECT
            ? IMAGE_TRANSITION_CHOICES
            : effect.id === PHONOSCOPE_CENTRE_FIT_EFFECT
              || effect.id === PHONOSCOPE_BG_FIT_EFFECT
              ? IMAGE_FIT_CHOICES
              : undefined,
    unit: PHONOSCOPE_SINGLE_VALUE_EFFECTS.has(effect.id)
      ? "%"
      : effect.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT
        || effect.id === PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT
        ? "°"
        : undefined,
    toggle: effect.id === PHONOSCOPE_GLOW_CLAMP_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT
      || effect.id === PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
    // A width is one number, not a sweep between two, so it is a plain slider
    // exactly as a latched transition axis is.
    pinned: effect.id === PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT
      || effect.id === PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT
      || effect.id === PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT
      || PHONOSCOPE_SINGLE_VALUE_EFFECTS.has(effect.id),
    companion: isCompanionEffect(effect.id),
  }));
  const module = moduleSettings
    .filter((setting) => setting.updateMode !== "structural")
    .map((setting) => ({
      id: setting.id,
      label: setting.label,
      description: setting.description,
      section: titleCase(setting.section ?? "General"),
      min: setting.min,
      max: setting.max,
      step: setting.step,
      default: setting.default,
    }));
  return [...picture, ...module];
}

export function effectOptionFor(catalogue: EffectOption[], id: string) {
  return catalogue.find((effect) => effect.id === id);
}

/**
 * A newly added effect, carrying the controls that ARE its control.
 *
 * An empty binding is legal — every unset field inherits the effect's
 * declaration — but it puts an effect on screen with nothing in it, which reads
 * as a broken row rather than as an invitation to add parameters. So an added
 * effect arrives with the parameters that make it editable: the axis it runs
 * on, and the ramp it takes to get there.
 *
 * Which ones those are is decided exactly as `EffectEntry` decides what it can
 * still offer, so adding an effect and adding every parameter by hand produce
 * the same binding:
 *
 * - A toggle or a discrete choice is pinned to its default: it is a state, not
 *   something a driver sweeps, and it takes no envelope because it cuts.
 * - A rotation pulse has no range at all — a firing is an instruction — but it
 *   keeps the envelope, which is its cross-fade.
 * - Anything else gets its full declared range and the standard envelope, which
 *   is what an unset binding already resolves to.
 */
export function newEffectBinding(id: string, effect: EffectOption): PhonoscopeEffectBinding {
  const binding: PhonoscopeEffectBinding = { id, effect: effect.id };
  // A pinned axis is discrete in every way that matters here: it is one chosen
  // value, it takes no envelope, and both ends of its range sit on it.
  const discrete = Boolean(effect.choices) || Boolean(effect.toggle) || Boolean(effect.pinned);
  if (!isPhonoscopeThemePulseEffect(effect.id)) {
    binding.min = discrete ? effect.default : effect.min;
    binding.max = discrete ? effect.default : effect.max;
  }
  // The transition is discrete — it cuts between modes — but its envelope is
  // not a shape the mode takes: it is the ramp the transition itself runs on,
  // and every transition has one. So it is the one discrete effect that arrives
  // carrying an envelope.
  if (!discrete || effect.id === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
    || effect.id === PHONOSCOPE_BG_TRANSITION_EFFECT) {
    binding.attackSeconds = 0.05;
    binding.holdSeconds = 0;
    binding.releaseSeconds = 0.6;
  }
  return binding;
}

