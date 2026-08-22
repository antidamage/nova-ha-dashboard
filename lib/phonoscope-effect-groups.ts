import {
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_GLOW_BLUR_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
} from "./phonoscope-drivers";

/**
 * The controls hierarchy, which is four levels deep and not three:
 *
 *   Lane (Beat)
 *   └─ Effect (Centre image)
 *      ├─ Parameter group (Size)
 *      │  ├─ Parameter (Width)
 *      │  ├─ Parameter (Height + Auto)
 *      │  ├─ Parameter (Scale)
 *      │  └─ Ramp            ← ONE, for the whole parameter group
 *      └─ Parameter group (Transition)
 *
 * An effect is one thing you add. Inside it, related parameters live TOGETHER in
 * a parameter group — not as siblings that happen to share a heading.
 *
 * A parameter group owns exactly ONE ramp, in every group without exception. The
 * parameters of a group move together, so a ramp per parameter is a control the
 * user would have to keep in sync by hand. It is written to every member of the
 * group that can take one; a discrete or pinned parameter cuts rather than
 * ramping and is simply not part of it. Nothing declares this — it is the rule,
 * not an option a group opts into.
 *
 * This is presentation only. Grouping changes nothing about how a binding is
 * stored, resolved or driven: each parameter is still its own effect id with its
 * own declared range and its own `PhonoscopeEffectBinding`, so both engines are
 * untouched, the conformance corpus is untouched, and a settings group saved
 * before this existed renders under the new headings without being migrated.
 */
export type PhonoscopeParameterGroup = {
  id: string;
  label: string;
  /**
   * Module settings that join here are one integer value, not a swept range —
   * the grid's width and height are percentages of the screen, exactly as the
   * picture-level ones in `PHONOSCOPE_SINGLE_VALUE_EFFECTS` are.
   */
  moduleSingleValue?: boolean;
  /**
   * Suffix on every readout in this group, for a group whose members are all in
   * one unit the module cannot state. `moduleSingleValue` already implies "%",
   * which is the pinned-percentage case; this is the general one, and a member
   * that declares its own unit still wins.
   *
   * It lives here rather than in the manifest because a unit is presentation
   * and the manifest is the engines' contract: a `unit` key on a setting would
   * mean a schema change, a compiler change and a new field both engines must
   * parse and ignore, to render a two-character suffix.
   */
  unit?: string;
  /**
   * Picture-level parameters, in display order. Module settings join the same
   * parameter group by naming its effect group in their manifest (`group: grid`),
   * and are listed before these — a module owns the geometry, the picture owns
   * how that geometry is composited. A manifest that names no parameter group
   * lands in the effect's first one.
   */
  effects: string[];
};

export type PhonoscopeEffectGroup = {
  id: string;
  label: string;
  section: string;
  parameterGroups: PhonoscopeParameterGroup[];
};

const PICTURE_SECTION = "Picture";
/** Module-owned motion effects, matching those settings' own `section`. */
const MOTION_SECTION = "Motion";

export const PHONOSCOPE_EFFECT_GROUPS: PhonoscopeEffectGroup[] = [
  {
    id: "centre",
    label: "Centre image",
    section: PICTURE_SECTION,
    parameterGroups: [
      // No size mode: the centre image is always manual. Width and height are
      // one-thumb percentages of the frame; Auto derives the height from the
      // width and the source's own shape. Scale multiplies whatever they
      // arrived at and is the one worth binding to a driver lane, so the ramp
      // sits with it.
      {
        id: "size",
        label: "Size",
        effects: [
          PHONOSCOPE_CENTRE_WIDTH_EFFECT,
          PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
          PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
          PHONOSCOPE_MESSAGE_SCALE_EFFECT,
        ],
      },
      // The mode's own control set shows and writes the axis, divisions and
      // return edge, because each only means anything under a particular mode.
      { id: "transition", label: "Transition", effects: [PHONOSCOPE_CENTRE_TRANSITION_EFFECT] },
    ],
  },
  {
    id: "glow",
    label: "Glow",
    section: PICTURE_SECTION,
    parameterGroups: [
      // Every glow control in one parameter group, so they share the one ramp
      // every group has. Opacity leads because at 0 both engines skip the pass
      // entirely.
      {
        id: "glow",
        label: "Glow",
        effects: [
          PHONOSCOPE_GLOW_OPACITY_EFFECT,
          PHONOSCOPE_GLOW_BLUR_EFFECT,
          PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
          PHONOSCOPE_GLOW_BLEND_EFFECT,
          PHONOSCOPE_GLOW_CLAMP_EFFECT,
        ],
      },
    ],
  },
  {
    id: "background",
    label: "Background image",
    section: PICTURE_SECTION,
    parameterGroups: [
      // Unlike the centre, the backdrop keeps its size mode: fit and fill derive
      // both axes from the image, and the sliders only appear under Manual.
      {
        id: "size",
        label: "Size",
        effects: [
          PHONOSCOPE_BG_FIT_EFFECT,
          PHONOSCOPE_BG_WIDTH_EFFECT,
          PHONOSCOPE_BG_HEIGHT_EFFECT,
          PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
          PHONOSCOPE_BG_SCALE_EFFECT,
        ],
      },
      { id: "transition", label: "Transition", effects: [PHONOSCOPE_BG_TRANSITION_EFFECT] },
    ],
  },
  {
    id: "grid",
    label: "Grid",
    section: PICTURE_SECTION,
    parameterGroups: [
      // The module contributes `grid_width` and `grid_height` here: its manifest
      // names the effect group, and with no parameter group named they land in
      // the first one, which is this.
      { id: "size", label: "Size", moduleSingleValue: true, effects: [] },
      // Dot size is deliberately NOT in Size. A parameter group owns exactly one
      // ramp, and how wide the lattice is and how big the things in it are are
      // two gestures rather than one -- sweeping the grid wider while the dots
      // stay put is the case this separation exists for.
      //
      // No `moduleSingleValue`: that pins both ends of the range together and
      // stamps a "%" on it, which is right for a width expressed as a share of
      // the frame and wrong for a swept pixel range. It carries its own unit
      // instead, because the pixels are real device pixels rather than a
      // fraction of anything. See
      // `nova-visualiser-modules/specs/particle-grid-dot-size.md`.
      { id: "dots", label: "Dots", unit: "px", effects: [] },
      { id: "blend", label: "Blend", effects: [PHONOSCOPE_SCENE_BLEND_EFFECT] },
    ],
  },
  // The two module-owned effects below hold no picture-level parameters at all:
  // every member arrives from the manifest naming the group. A module without
  // them — anything that is not a ripple lattice — simply never sees the effect,
  // because `effectGroups` drops a group whose parameters are all absent.
  {
    id: "ripple",
    label: "Ripple",
    section: MOTION_SECTION,
    // Both members are energy fed to the same beat wave, so they belong on one
    // ramp: a lane that pushes the ripple harder should push all of it.
    parameterGroups: [{ id: "ripple", label: "Ripple", effects: [] }],
  },
  {
    id: "flare",
    label: "Flare",
    section: MOTION_SECTION,
    // The crest lighting up as a ripple passes: when it starts, how bright it
    // gets, how it arrives and how it leaves.
    //
    // NOT "Glow" — that is the whole-frame overlay pass, a different thing at a
    // different stage of the pipeline. "Flare" is the term both engines already
    // use for this (`render.flareGlow`, `render.flareThreshold`,
    // `render.flareSize`, `linearFlare`), so the panel and the code now agree.
    //
    // One parameter group for all six, on the Glow group's precedent: five
    // heterogeneous glow parameters already share one ramp there. Timing and
    // intensity move together because they describe one gesture.
    parameterGroups: [{ id: "flare", label: "Flare", effects: [] }],
  },
];

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
