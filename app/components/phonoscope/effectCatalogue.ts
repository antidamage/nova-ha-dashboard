/**
 * The phonoscope effect picker — facade. The body lives beside this file; it
 * keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   types.ts                  ModuleSetting, EffectOption, the resolved groups
 *   effect-choices.ts         fixed choice lists, transition companions
 *   effect-catalogue-model.ts the per-module catalogue, new bindings
 *   effect-groups-model.ts    group resolution and the effect/parameter indexes
 *   driver-labels.ts          driver, cadence and lane labelling
 */
export type { EffectOption, ModuleSetting, ResolvedEffectGroup, ResolvedParameterGroup } from "./types";
export type { TransitionCompanion } from "./effect-choices";
export {
  BACKGROUND_TRANSITION_COMPANIONS,
  CENTRE_TRANSITION_COMPANIONS,
  GLOW_BLEND_CHOICES,
  IMAGE_FIT_CHOICES,
  IMAGE_TRANSITION_CHOICES,
  SCENE_BLEND_CHOICES,
  isCompanionEffect,
  transitionCompanionsFor,
} from "./effect-choices";
export { effectCatalogue, effectOptionFor, newEffectBinding } from "./effect-catalogue-model";
export { effectGroupIndex, effectGroups, parameterGroupIndex } from "./effect-groups-model";
export {
  DIVIDE_CHOICES,
  DRIVER_TYPES,
  EVERY_CHOICES,
  cadenceChoices,
  cadenceValue,
  driverLabel,
  driverPulseNoun,
  driverSupportsCycle,
  driverSupportsDivide,
  driverTypeLabel,
  effectNeedsPulseDriver,
  laneLabel,
  ordinal,
  subdivisionLabel,
} from "./driver-labels";
