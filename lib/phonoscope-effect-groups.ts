import {
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_GLOW_BLUR_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
} from "./phonoscope-drivers";

/**
 * Effect groups: one thing you add, with parameters you then add to it.
 *
 * The glow is one effect with an opacity, a blur, an overdrive, a blend mode and
 * a clamp — not five entries in the picker that happen to share a prefix. Same
 * for the backdrop's width and height, and for the lattice's extent and the
 * blend mode the particle layer meets the backdrop with.
 *
 * This is presentation only. Grouping changes nothing about how a binding is
 * stored, resolved or driven: each member is still its own effect id with its
 * own declared range and its own `PhonoscopeEffectBinding`, so both engines are
 * untouched, the conformance corpus is untouched, and a settings group saved
 * before this existed renders under the new headings without being migrated.
 */
export type PhonoscopeEffectGroup = {
  id: string;
  label: string;
  description: string;
  section: string;
  /**
   * Picture-level members, in display order. Module settings join the same
   * group by naming it in their manifest (`group: <id>` beside `section:`), and
   * are listed before these in manifest order — a module owns the geometry, the
   * picture owns how that geometry is composited.
   */
  effects: string[];
};

const PICTURE_SECTION = "Picture";

export const PHONOSCOPE_EFFECT_GROUPS: PhonoscopeEffectGroup[] = [
  {
    id: "centre",
    label: "Centre",
    description:
      "The middle of the picture: the colour theme's image, or the message that overrides it.",
    section: PICTURE_SECTION,
    // Height leads because it is the base size the image actually is; scale is
    // the multiplier on top, and it is the one worth binding to a driver lane.
    effects: [PHONOSCOPE_CENTRE_HEIGHT_EFFECT, PHONOSCOPE_MESSAGE_SCALE_EFFECT],
  },
  {
    id: "glow",
    label: "Glow",
    description: "A blurred copy of the finished picture laid back over itself.",
    section: PICTURE_SECTION,
    // Opacity leads because it is the switch: at 0 both engines skip the pass
    // entirely, so it is the parameter that decides whether the group does
    // anything at all.
    effects: [
      PHONOSCOPE_GLOW_OPACITY_EFFECT,
      PHONOSCOPE_GLOW_BLUR_EFFECT,
      PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
      PHONOSCOPE_GLOW_BLEND_EFFECT,
      PHONOSCOPE_GLOW_CLAMP_EFFECT,
    ],
  },
  {
    id: "background",
    label: "Background",
    description: "The backdrop band the picture sits in.",
    section: PICTURE_SECTION,
    effects: [PHONOSCOPE_BG_WIDTH_EFFECT, PHONOSCOPE_BG_HEIGHT_EFFECT],
  },
  {
    id: "grid",
    label: "Grid",
    description: "The particle lattice: how much of the frame it covers, and how it meets the backdrop.",
    section: PICTURE_SECTION,
    // The module contributes `grid_width` and `grid_height` via its manifest.
    effects: [PHONOSCOPE_SCENE_BLEND_EFFECT],
  },
];

const GROUP_BY_PICTURE_EFFECT = new Map<string, string>(
  PHONOSCOPE_EFFECT_GROUPS.flatMap((group) =>
    group.effects.map((effect) => [effect, group.id] as const)),
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
