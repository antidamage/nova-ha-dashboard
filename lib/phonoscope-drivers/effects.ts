import type { PhonoscopeCentreTransition, PhonoscopeImageFit, PhonoscopePlaybackOrder } from "./types";

/** Private picture-level effects: household configuration, declared by no module. */
export const PHONOSCOPE_GLOW_BLUR_EFFECT = "__glowBlur";
export const PHONOSCOPE_GLOW_OPACITY_EFFECT = "__glowOpacity";
export const PHONOSCOPE_GLOW_OVERDRIVE_EFFECT = "__glowOverdrive";
export const PHONOSCOPE_GLOW_CLAMP_EFFECT = "__glowClamp";
export const PHONOSCOPE_GLOW_BLEND_EFFECT = "__glowBlend";
export const PHONOSCOPE_MESSAGE_SCALE_EFFECT = "__messageScale";
/**
 * The centre slot's size, as percentages of the frame.
 *
 * Width is the AUTHORED axis and height follows from it under `__centreProportional`
 * — the same rule the background image obeys, so one mental model covers both
 * slots. `__centreHeight` predates the width axis (it was the authored one when
 * the centre could only ever keep its source's proportions) and is kept as the
 * free height for the un-proportional case; `phonoscope-migrate-v6.ts` repoints
 * the old value at the width axis, unchanged. Neither axis is ever derived from
 * an image's dimensions: a slider says what was put on it.
 */
export const PHONOSCOPE_CENTRE_HEIGHT_EFFECT = "__centreHeight";
export const PHONOSCOPE_CENTRE_WIDTH_EFFECT = "__centreWidth";
/** Manual / fit to screen / fill screen. APPEND-ONLY; see `ImageFit`. */
export const PHONOSCOPE_CENTRE_FIT_EFFECT = "__centreFit";
/** 0/1: height follows the width and the image's native proportions. */
export const PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT = "__centreProportional";
export const PHONOSCOPE_HUE_OFFSET_EFFECT = "__hueOffset";
export const PHONOSCOPE_THEME_CHANGE_EFFECT = "__themeChange";
/**
 * Toggles the household's alt-theme state. Each firing flips it, so the picture
 * blends to the current entry's alt theme and the next firing blends back.
 */
export const PHONOSCOPE_ALT_THEME_EFFECT = "__altTheme";
/**
 * Frame geometry and the vignette framing it.
 *
 * Agnostic about what the backdrop actually is: when the colour theme names a
 * `backgroundImageId` these size that image, and when it does not they size the
 * procedural band exactly as they always have. That is the whole point of
 * sizing the backdrop rather than sizing a picture — the controls do not change
 * when the content does.
 */
export const PHONOSCOPE_BG_HEIGHT_EFFECT = "__bgHeight";
export const PHONOSCOPE_BG_WIDTH_EFFECT = "__bgWidth";
/**
 * A multiplier on top of the width and height, and the one axis here worth
 * binding to a driver lane: it is what makes the backdrop thump on the beat.
 * Applies in every fit mode, so a fitted or filled image can still be swept.
 */
export const PHONOSCOPE_BG_SCALE_EFFECT = "__bgScale";
/** Manual / fit to screen / fill screen. APPEND-ONLY; see `ImageFit`. */
export const PHONOSCOPE_BG_FIT_EFFECT = "__bgFit";
/** 0/1: height follows the width and the image's native proportions. */
export const PHONOSCOPE_BG_PROPORTIONAL_EFFECT = "__bgProportional";
export const PHONOSCOPE_VIGNETTE_OPACITY_EFFECT = "__vignetteOpacity";
export const PHONOSCOPE_VIGNETTE_SIZE_EFFECT = "__vignetteSize";
/** How the scene layer meets the backdrop. */
export const PHONOSCOPE_SCENE_BLEND_EFFECT = "__sceneBlend";
/**
 * How the centre image changes when the rotation moves to an entry naming a
 * different one: cross-fade, flip, or slide, plus the three parameters the
 * latter two read. See `centre_image_transition.h` for the geometry.
 */
export const PHONOSCOPE_CENTRE_TRANSITION_EFFECT = "__centreTransition";
export const PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT = "__centreTransitionAxis";
export const PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT = "__centreTransitionDivisions";
export const PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT = "__centreTransitionReturn";
/**
 * The same four axes for the background image. Separate from the centre's on
 * purpose: the two slots change at the same moment but are not the same
 * picture, and dissolving the backdrop while the centrepiece slides is a
 * combination worth being able to author.
 */
export const PHONOSCOPE_BG_TRANSITION_EFFECT = "__bgTransition";
export const PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT = "__bgTransitionAxis";
export const PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT = "__bgTransitionDivisions";
export const PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT = "__bgTransitionReturn";

/**
 * Effects that always combine by `override`, whatever a settings group stored.
 *
 * A transition is one indivisible instruction: half a flip summed with half a
 * slide is not a transition, it is a fault. So these axes never stack — the
 * last group in the entry's list replaces the value outright, which is exactly
 * what "an override group beats the defaults" has to mean. The "When stacked"
 * control is not offered for them.
 */
export const PHONOSCOPE_OVERRIDE_ONLY_EFFECTS: ReadonlySet<string> = new Set([
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
]);

export function isPhonoscopeOverrideOnlyEffect(effect: string) {
  return PHONOSCOPE_OVERRIDE_ONLY_EFFECTS.has(effect);
}



export const PHONOSCOPE_IMAGE_FIT_VALUES: Record<PhonoscopeImageFit, number> = {
  manual: 0,
  fit: 1,
  fill: 2,
};

export function phonoscopeImageFit(value: number | undefined): PhonoscopeImageFit {
  if ((value ?? 0) >= 1.5) return "fill";
  if ((value ?? 0) >= 0.5) return "fit";
  return "manual";
}



export const PHONOSCOPE_CENTRE_TRANSITION_VALUES: Record<PhonoscopeCentreTransition, number> = {
  crossfade: 0,
  flip: 1,
  slide: 2,
};

export function phonoscopeCentreTransition(value: number | undefined): PhonoscopeCentreTransition {
  if ((value ?? 0) >= 1.5) return "slide";
  if ((value ?? 0) >= 0.5) return "flip";
  return "crossfade";
}

/**
 * The two rotation pulses: a firing is an instruction, not a magnitude.
 *
 * Both are fixed at the declared 0-1 range — any non-zero contribution is one
 * firing — and both read their binding's release as the cross-fade the picture
 * takes to reach the new palette, which is why neither offers a range and both
 * label their envelope "Transition".
 */
export function isPhonoscopeThemePulseEffect(effect: string) {
  return effect === PHONOSCOPE_THEME_CHANGE_EFFECT || effect === PHONOSCOPE_ALT_THEME_EFFECT;
}



export function phonoscopePlaybackOrder(value: number | undefined): PhonoscopePlaybackOrder {
  if ((value ?? 0) >= 1.5) return "once";
  if ((value ?? 0) >= 0.5) return "shuffle";
  return "loop";
}

export const PHONOSCOPE_PLAYBACK_ORDER_VALUES: Record<PhonoscopePlaybackOrder, number> = {
  loop: 0,
  shuffle: 1,
  once: 2,
};

/**
 * A combined value may exceed the effect's declared maximum — stacking lanes is
 * meant to be able to overshoot. This is only the guard that keeps the
 * simulation finite: at most four full ranges above the resting value.
 */
export const PHONOSCOPE_OVERSHOOT_RANGES = 4;

/** The most a lane's summed driver signal can reach before it is clamped. */
export const PHONOSCOPE_MAX_LANE_SIGNAL = 4;

