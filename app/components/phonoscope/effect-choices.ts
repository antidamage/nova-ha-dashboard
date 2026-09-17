/**
 * The fixed choice lists and companion tables the effect picker offers.
 * Split out of `effectCatalogue.ts` (specs/agent-token-footprint.md §4).
 */
import {
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
} from "../../../lib/phonoscope-drivers";

export const PICTURE_SECTION = "Picture";

/**
 * The blend axis is 0 screen, 1 multiply, 2 overlay and is append-only, so the
 * numbers are fixed. Only the presentation order is a matter of taste, and this
 * is the order the modes are listed in.
 */
export const GLOW_BLEND_CHOICES = [
  { value: 0, label: "Screen" },
  { value: 2, label: "Overlay" },
  { value: 1, label: "Multiply" },
];

/**
 * The scene blend axis is its own, separate from the glow's: 0 linear, 1 screen,
 * 2 overlay, 3 multiply, likewise append-only. Linear is the original composite
 * term, so it leads — picking it is picking "leave the picture alone".
 */
export const SCENE_BLEND_CHOICES = [
  { value: 0, label: "Linear" },
  { value: 1, label: "Screen" },
  { value: 2, label: "Overlay" },
  { value: 3, label: "Multiply" },
];

/**
 * How an image changes: 0 cross-fade, 1 flip, 2 slide, append-only. Cross-fade
 * leads because it is 0 and it is what the picture did before the other two
 * existed. Shared by the centre and the background, which have identical modes
 * on separate axes — so it is not named for either of them.
 */
export const IMAGE_TRANSITION_CHOICES = [
  { value: 0, label: "Cross-fade" },
  { value: 1, label: "Flip" },
  { value: 2, label: "Slide" },
];

/**
 * How an image is sized: 0 manual, 1 fit to screen, 2 fill screen, append-only.
 * Manual leads because it is 0 and it is the width and height the sliders under
 * it state — the other two derive both from the image and hide them.
 */
export const IMAGE_FIT_CHOICES = [
  { value: 0, label: "Manual" },
  { value: 1, label: "Fit to screen" },
  { value: 2, label: "Fill screen" },
];

export type TransitionCompanion = { id: string; minimumMode: number };

/**
 * The three axes a transition's control set owns, and which mode each needs.
 *
 * Cross-fade uses none of them, a flip runs on the axis, and only a slide can
 * be divided or sent back the way it came.
 */
export const CENTRE_TRANSITION_COMPANIONS: TransitionCompanion[] = [
  { id: PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT, minimumMode: 1 },
  { id: PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT, minimumMode: 2 },
  { id: PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT, minimumMode: 2 },
];

/** The background image's, with the same modes and therefore the same rule. */
export const BACKGROUND_TRANSITION_COMPANIONS: TransitionCompanion[] = [
  { id: PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT, minimumMode: 1 },
  { id: PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT, minimumMode: 2 },
  { id: PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT, minimumMode: 2 },
];

/**
 * Which control set owns which companions, keyed by the mode axis that shows
 * them. Two slots, identical rules, so the lookup is by mode rather than the
 * centre's list being the one everything reaches for.
 */
const TRANSITION_COMPANIONS = new Map<string, TransitionCompanion[]>([
  [PHONOSCOPE_CENTRE_TRANSITION_EFFECT, CENTRE_TRANSITION_COMPANIONS],
  [PHONOSCOPE_BG_TRANSITION_EFFECT, BACKGROUND_TRANSITION_COMPANIONS],
]);

export function transitionCompanionsFor(modeEffect: string): TransitionCompanion[] {
  return TRANSITION_COMPANIONS.get(modeEffect) ?? [];
}

const COMPANION_IDS = new Set(
  [...TRANSITION_COMPANIONS.values()].flat().map((companion) => companion.id));

/** True for a value some other effect's control set owns. */
export function isCompanionEffect(id: string) {
  return COMPANION_IDS.has(id);
}
