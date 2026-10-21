import {
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
} from "./phonoscope-drivers";
import {
  PHONOSCOPE_EFFECT_GROUPS,
  type PhonoscopeEffectGroup,
} from "./phonoscope-effect-groups/groups.data";

export { PHONOSCOPE_EFFECT_GROUPS };
export type { PhonoscopeEffectGroup, PhonoscopeParameterGroup } from "./phonoscope-effect-groups/groups.data";

/**
 * Sizes authored as ONE integer percentage of the screen, edited with a
 * single-thumb slider. Not every slider is a range slider: a width is a width.
 */
export const PHONOSCOPE_SINGLE_VALUE_EFFECTS = new Set<string>([
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_BG_HEIGHT_EFFECT,
]);

/** Every picture-level parameter of an effect group, across its parameter groups. */
export function phonoscopeGroupEffects(group: PhonoscopeEffectGroup) {
  return group.parameterGroups.flatMap((parameters) => parameters.effects);
}

const GROUP_BY_PICTURE_EFFECT = new Map<string, string>(
  PHONOSCOPE_EFFECT_GROUPS.flatMap((group) =>
    phonoscopeGroupEffects(group).map((effect) => [effect, group.id] as const)),
);

/**
 * Which group an effect belongs to, or undefined for one that stands alone.
 *
 * `moduleGroups` maps a module setting id to the group its manifest named, so a
 * module can join a group without this file knowing the module exists.
 */
export function phonoscopeEffectGroupId(
  effectId: string,
  moduleGroups: Map<string, string> = new Map(),
) {
  return GROUP_BY_PICTURE_EFFECT.get(effectId) ?? moduleGroups.get(effectId);
}

/** The size-control members of a slot, so the rule below can be stated once. */
type SizeControls = {
  fit?: string;
  width: string;
  height: string;
  proportional: string;
};

const CENTRE_SIZE_CONTROLS: SizeControls = {
  width: PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  height: PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  proportional: PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
};

const BACKGROUND_SIZE_CONTROLS: SizeControls = {
  fit: PHONOSCOPE_BG_FIT_EFFECT,
  width: PHONOSCOPE_BG_WIDTH_EFFECT,
  height: PHONOSCOPE_BG_HEIGHT_EFFECT,
  proportional: PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
};

const SIZE_CONTROLS_BY_GROUP = new Map<string, SizeControls>([
  ["centre", CENTRE_SIZE_CONTROLS],
  ["background", BACKGROUND_SIZE_CONTROLS],
]);

/**
 * Whether a size control can affect the picture as things currently stand.
 *
 * Every rule here is "this control has nothing to act on" rather than "this
 * control is disabled":
 *
 *  - Without an image there are no proportions to fit, so the size mode and the
 *    Auto flag mean nothing. The backdrop still has a width and a height — the
 *    procedural field is sized by them exactly as it always was.
 *  - Fit and fill derive BOTH axes from the image, so neither slider is
 *    authored under them. Only the backdrop has that mode.
 *  - Auto derives the height from the width, so the height is not authored
 *    under it either.
 *
 * The scale is never gated: it multiplies whatever the mode arrived at, in
 * every mode. Nor is the transition — a transition happens whatever size the
 * thing being transitioned is.
 */
export function isPhonoscopeSizeControlRelevant(
  groupId: string,
  effectId: string,
  state: { hasImage: boolean; fit: number; proportional: boolean },
): boolean {
  const controls = SIZE_CONTROLS_BY_GROUP.get(groupId);
  if (!controls) return true;
  if (effectId === controls.fit || effectId === controls.proportional) return state.hasImage;
  const derivedByMode = Boolean(controls.fit) && state.hasImage && Math.round(state.fit) !== 0;
  if (effectId === controls.width) return !derivedByMode;
  if (effectId === controls.height) {
    return !derivedByMode && !(state.hasImage && state.proportional);
  }
  return true;
}
