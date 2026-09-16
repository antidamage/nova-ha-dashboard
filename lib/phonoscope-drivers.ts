/**
 * The Phonoscope driver-lane evaluator — facade. The body lives in
 * lib/phonoscope-drivers/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3).
 *
 * The package is the reference implementation of the semantics described in
 * PHONOSCOPE_MODULE_SPEC.md under "Driver lanes". Two other engines implement
 * the same rules and must agree with it exactly:
 *
 * - `nova-visualiser/src/core/parameter_drivers.{h,cpp}` (C++, the renderer)
 * - `NovaAppleTVDashboard/PhonoscopeStore.swift` (Swift, the tvOS fallback)
 *
 * The dashboard needs its own copy because two effects never reach either
 * engine: `__hueOffset` drives House Party lighting from `lib/ha.ts`, and
 * `__themeChange` advances the rotation in `lib/phonoscope-theme-state/`.
 * Changing anything here means changing all three and re-recording
 * `nova-visualiser/tests/conformance/parameter-drivers`.
 *
 *   phonoscope-drivers/types.ts          signal frame, slot state, enum shapes
 *   phonoscope-drivers/effects.ts        private picture-effect ids, the
 *                                        override-only set, fit/transition/
 *                                        playback enums
 *   phonoscope-drivers/signal-model.ts   stable seed, pulse predicates, cadence,
 *                                        windows and periods, slot-state lookup
 *   phonoscope-drivers/envelope.ts       transition ramp, pulse envelope, follower
 *   phonoscope-drivers/driver-signal.ts  pulse event keys, jittered pulse, one
 *                                        driver's signal
 *   phonoscope-drivers/evaluate.ts       group merge, lane evaluation, combine
 *                                        modes, phonoscopeDriver defaults
 */
export type {
  PhonoscopeCentreTransition,
  PhonoscopeDriverState,
  PhonoscopeDriverStates,
  PhonoscopeEffectDeclaration,
  PhonoscopeImageFit,
  PhonoscopePlaybackOrder,
  PhonoscopeSignalFrame,
} from "./phonoscope-drivers/types";
export {
  isPhonoscopeOverrideOnlyEffect,
  isPhonoscopeThemePulseEffect,
  PHONOSCOPE_ALT_THEME_EFFECT,
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_VALUES,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_GLOW_BLUR_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
  PHONOSCOPE_HUE_OFFSET_EFFECT,
  PHONOSCOPE_IMAGE_FIT_VALUES,
  PHONOSCOPE_MAX_LANE_SIGNAL,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_OVERRIDE_ONLY_EFFECTS,
  PHONOSCOPE_OVERSHOOT_RANGES,
  PHONOSCOPE_PLAYBACK_ORDER_VALUES,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  PHONOSCOPE_VIGNETTE_OPACITY_EFFECT,
  PHONOSCOPE_VIGNETTE_SIZE_EFFECT,
  phonoscopeCentreTransition,
  phonoscopeImageFit,
  phonoscopePlaybackOrder,
} from "./phonoscope-drivers/effects";
export {
  createPhonoscopeDriverStates,
  driverDivide,
  driverFiresEvents,
  driverFiresOn,
  driverPeriodSeconds,
  isPulseDriver,
  PHONOSCOPE_DIVIDE_CHOICES,
  seedFraction,
  stablePhonoscopeSeed,
} from "./phonoscope-drivers/signal-model";
export { phonoscopeTransitionRamp } from "./phonoscope-drivers/envelope";
export {
  evaluatePhonoscopeDriverLanes,
  mergePhonoscopeSettingsGroups,
  phonoscopeDriver,
} from "./phonoscope-drivers/evaluate";
