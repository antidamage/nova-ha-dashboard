import type { PhonoscopeEffectDeclaration } from "./phonoscope-drivers";
import {
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_GLOW_BLUR_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_GLOW_CLAMP_EFFECT,
  PHONOSCOPE_GLOW_OVERDRIVE_EFFECT,
  PHONOSCOPE_HUE_OFFSET_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_SCENE_BLEND_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_ALT_THEME_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  PHONOSCOPE_VIGNETTE_OPACITY_EFFECT,
  PHONOSCOPE_VIGNETTE_SIZE_EFFECT,
} from "./phonoscope-drivers";
import type { PhonoscopeSetting } from "./phonoscope";

/**
 * The picture-level effects.
 *
 * These belong to the household rather than to any module, so no manifest
 * declares them — the engines synthesise the same declarations (see
 * `applyControlLanes` in engine.cpp and the private settings in
 * PhonoscopeStore.swift). Anything here can be bound to a driver lane exactly
 * like a module setting.
 */
export const PHONOSCOPE_PICTURE_EFFECTS: PhonoscopeEffectDeclaration[] = [
  { id: PHONOSCOPE_GLOW_BLUR_EFFECT, min: 0, max: 20, step: 0.1, default: 0 },
  // Opacity 0 is the identity, and it is what both engines check to skip the
  // glow pass entirely. A new install therefore pays nothing for this layer.
  { id: PHONOSCOPE_GLOW_OPACITY_EFFECT, min: 0, max: 100, step: 1, default: 0 },
  // Multiplied into the blurred copy before it is clamped, so it drives the
  // glow towards saturation rather than simply mixing more of it in. 1 is the
  // identity.
  { id: PHONOSCOPE_GLOW_OVERDRIVE_EFFECT, min: 1, max: 10, step: 0.1, default: 1 },
  // Whether the overdriven glow is clamped back into 0-1. Clamped (the
  // default) it saturates; unclamped the overdriven RGB carries past 1 and
  // the blend pushes the picture towards white.
  { id: PHONOSCOPE_GLOW_CLAMP_EFFECT, min: 0, max: 1, step: 1, default: 1 },
  // 0 screen, 1 multiply, 2 overlay. Append-only: a stored binding keeps a
  // numeric range on this axis, so renumbering silently repoints configurations.
  { id: PHONOSCOPE_GLOW_BLEND_EFFECT, min: 0, max: 2, step: 1, default: 0 },
  { id: PHONOSCOPE_MESSAGE_SCALE_EFFECT, min: 0.1, max: 5, step: 0.1, default: 1 },
  // The centre image's base height, as a percentage of the frame. Separate from
  // the scale above on purpose: this is how big the image IS, and the scale is a
  // multiplier a driver lane can sweep on top of it. A third of the frame is a
  // centrepiece rather than a backdrop, which is what a centre image wants to be.
  { id: PHONOSCOPE_CENTRE_HEIGHT_EFFECT, min: 0, max: 100, step: 1, default: 33 },
  // Degrees of random hue jitter applied per House Party light. The default is
  // 5 because that is what this household ran as `housePartyRandomHueOffset`
  // before the value became a driveable effect.
  { id: PHONOSCOPE_HUE_OFFSET_EFFECT, min: 0, max: 180, step: 1, default: 5 },
  // A pulse, not a level: any non-zero contribution advances the colour group's
  // rotation by one entry. The binding's envelope is the cross-fade, and
  // `params.order` chooses sequential or shuffle.
  { id: PHONOSCOPE_THEME_CHANGE_EFFECT, min: 0, max: 1, step: 1, default: 0 },
  // The other rotation pulse: each firing flips the household's alt state, so
  // the picture blends to the current entry's alt theme and the firing after
  // that blends back. Same fixed 0-1 range for the same reason.
  { id: PHONOSCOPE_ALT_THEME_EFFECT, min: 0, max: 1, step: 1, default: 0 },
  // Frame geometry, as a PERCENTAGE of the render view. The defaults are the
  // fixed letterbox these replaced: a centred band one third high and full
  // width. Authored 0-100 because "33%" is what the control means; each engine
  // divides by 100 once, at the point it clamps the value.
  { id: PHONOSCOPE_BG_HEIGHT_EFFECT, min: 0, max: 100, step: 1, default: 33 },
  { id: PHONOSCOPE_BG_WIDTH_EFFECT, min: 0, max: 100, step: 1, default: 100 },
  // 96% and 1 are the authored edge vignette exactly, so an undriven frame is
  // the one that was always drawn. Size stays a plain multiplier rather than a
  // percentage because it can go past 1 — that is how the vignette closes the
  // band down to a slit.
  { id: PHONOSCOPE_VIGNETTE_OPACITY_EFFECT, min: 0, max: 100, step: 1, default: 96 },
  { id: PHONOSCOPE_VIGNETTE_SIZE_EFFECT, min: 0, max: 3, step: 0.05, default: 1 },
  // 0 linear, 1 screen, 2 overlay, 3 multiply. Append-only for the same reason
  // as the glow axis: a stored binding keeps a numeric range on it. Linear is
  // the original composite term and so the default.
  { id: PHONOSCOPE_SCENE_BLEND_EFFECT, min: 0, max: 3, step: 1, default: 0 },
  // How the centre image changes when the rotation moves to an entry naming a
  // different one. 0 cross-fade, 1 flip, 2 slide; append-only, and cross-fade
  // is 0 because it is what every existing configuration already does.
  //
  // All four axes are override-only (see PHONOSCOPE_OVERRIDE_ONLY_EFFECTS): a
  // transition is one instruction, and summing two of them is meaningless.
  { id: PHONOSCOPE_CENTRE_TRANSITION_EFFECT, min: 0, max: 2, step: 1, default: 0 },
  // Degrees. 0 collapses or travels horizontally, 90 vertically, and the full
  // circle is authored because the two halves are not the same picture once the
  // image is divided: 45 and 225 send the segments opposite ways.
  { id: PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT, min: 0, max: 360, step: 1, default: 0 },
  // How many times a sliding image is cut. 0 is a solid image; 1 pushes the two
  // halves apart; 2 sends the outer sections one way and the middle the other,
  // and so on alternating up to 10 cuts.
  { id: PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT, min: 0, max: 10, step: 1, default: 0 },
  // Where a slid segment comes back from: 0 the opposite edge (it carries on in
  // the direction it left), 1 the edge it left by (it reverses). Opposite is the
  // default because it reads as one continuous movement.
  { id: PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT, min: 0, max: 1, step: 1, default: 0 },
];

const PICTURE_EFFECT_IDS = new Set(PHONOSCOPE_PICTURE_EFFECTS.map((effect) => effect.id));

export function isPicturePhonoscopeEffect(id: string) {
  return PICTURE_EFFECT_IDS.has(id);
}

/**
 * Human-facing labels and grouping for the "+ Add effect" picker. Module
 * settings supply their own label and `section`; these are the ones that have
 * nowhere else to come from.
 *
 * `shortLabel` is how the effect reads inside its group in
 * `phonoscope-effect-groups.ts`, where the heading already says "Glow" and
 * repeating it in every row is just noise.
 */
export const PHONOSCOPE_PICTURE_EFFECT_LABELS: Record<
  string,
  { label: string; shortLabel?: string; description: string }
> = {
  [PHONOSCOPE_GLOW_BLUR_EFFECT]: {
    label: "Glow blur",
    shortLabel: "Blur",
    description: "Softness of the glow laid back over the finished picture.",
  },
  [PHONOSCOPE_GLOW_OPACITY_EFFECT]: {
    label: "Glow opacity",
    shortLabel: "Opacity",
    description: "How much of the glow layer is blended in. Zero disables the pass entirely.",
  },
  [PHONOSCOPE_GLOW_OVERDRIVE_EFFECT]: {
    label: "Glow overdrive",
    shortLabel: "Overdrive",
    description:
      "Multiplies the glow before the blend, pushing it into saturation. 1 leaves it untouched.",
  },
  [PHONOSCOPE_GLOW_CLAMP_EFFECT]: {
    label: "Glow clamp",
    shortLabel: "Clamp",
    description:
      "On, overdrive saturates the glow. Off, it multiplies RGB past 1 and blows the picture out to white.",
  },
  [PHONOSCOPE_GLOW_BLEND_EFFECT]: {
    label: "Glow blend mode",
    shortLabel: "Blend mode",
    description: "Screen, multiply or overlay. Driven, it cuts between them rather than fading.",
  },
  [PHONOSCOPE_MESSAGE_SCALE_EFFECT]: {
    label: "Centre scale",
    shortLabel: "Scale",
    description:
      "Multiplies the centre image or message. The one worth binding to a driver lane: bound to a beat, the centrepiece pumps.",
  },
  [PHONOSCOPE_CENTRE_HEIGHT_EFFECT]: {
    label: "Centre height",
    shortLabel: "Height",
    description:
      "How tall the colour theme's centre image is drawn, as a percentage of the frame. Width follows the source's proportions.",
  },
  [PHONOSCOPE_HUE_OFFSET_EFFECT]: {
    label: "Random light hue offset",
    description: "Degrees each House Party light independently jitters its hue by.",
  },
  [PHONOSCOPE_THEME_CHANGE_EFFECT]: {
    label: "Change colour theme",
    description: "Advances the colour group to its next entry. The envelope is the cross-fade.",
  },
  [PHONOSCOPE_ALT_THEME_EFFECT]: {
    label: "Change to alt theme",
    description:
      "Flips the household between each entry's main and alt colour theme. Entries with no alt keep their own. The envelope is the cross-fade.",
  },
  [PHONOSCOPE_BG_HEIGHT_EFFECT]: {
    label: "Background height",
    shortLabel: "Height",
    description:
      "Height of the backdrop band as a percentage of the frame. Outside it the picture is vignette colour.",
  },
  [PHONOSCOPE_BG_WIDTH_EFFECT]: {
    label: "Background width",
    shortLabel: "Width",
    description: "Width of the backdrop band as a percentage of the frame.",
  },
  [PHONOSCOPE_VIGNETTE_OPACITY_EFFECT]: {
    label: "Vignette opacity",
    description:
      "How dark the four edge gradients get where they meet the edge of the band, as a percentage.",
  },
  [PHONOSCOPE_VIGNETTE_SIZE_EFFECT]: {
    label: "Vignette size",
    description:
      "How far the edge gradients reach in. Past 1 they meet in the middle and close the band down.",
  },
  [PHONOSCOPE_SCENE_BLEND_EFFECT]: {
    label: "Particle blend mode",
    shortLabel: "Blend mode",
    description:
      "How the particle layer meets the backdrop: linear, screen, overlay or multiply. Driven, it cuts between them rather than fading.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: {
    label: "Centre transition",
    shortLabel: "Transition",
    description:
      "How the centre image changes when the rotation moves on: cross-fade, flip, or slide off and back. The entry the change STARTS from owns the transition; the one it lands on has no say in it.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT]: {
    label: "Centre transition axis",
    shortLabel: "Axis",
    description:
      "Degrees. 0 flips or slides horizontally, 90 vertically. No effect on a cross-fade.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT]: {
    label: "Centre transition divisions",
    shortLabel: "Divisions",
    description:
      "How many times a sliding image is cut across the axis. Sections travel in alternating directions, so 1 pushes the halves apart and 2 sends the outer two one way and the middle the other. Slide only.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT]: {
    label: "Return from the origin edge",
    shortLabel: "Return edge",
    description:
      "Off, a slid section carries on in the direction it left and enters from the opposite edge. On, it reverses and comes back the way it went. Slide only.",
  },
};

/**
 * Every effect a settings group can bind for a given module: the module's own
 * driveable settings plus the picture-level ones.
 *
 * Structural settings are excluded — they rebuild the scene and cannot be
 * driven, so they are edited directly on the settings group instead.
 */
export function phonoscopeEffectDeclarations(
  moduleSettings: PhonoscopeSetting[],
): Map<string, PhonoscopeEffectDeclaration> {
  const declarations = new Map<string, PhonoscopeEffectDeclaration>();
  for (const effect of PHONOSCOPE_PICTURE_EFFECTS) declarations.set(effect.id, { ...effect });
  for (const setting of moduleSettings) {
    if (setting.updateMode === "structural") continue;
    declarations.set(setting.id, {
      id: setting.id,
      min: setting.min,
      max: setting.max,
      step: setting.step,
      default: setting.default,
    });
  }
  return declarations;
}

/** The settings a module declares that cannot be driven and must be set directly. */
export function phonoscopeStaticSettings(moduleSettings: PhonoscopeSetting[]) {
  return moduleSettings.filter((setting) => setting.updateMode === "structural");
}
