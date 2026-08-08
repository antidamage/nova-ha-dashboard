import type { PhonoscopeEffectDeclaration } from "./phonoscope-drivers";
import {
  PHONOSCOPE_BG_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_HEIGHT_EFFECT,
  PHONOSCOPE_CENTRE_WIDTH_EFFECT,
  PHONOSCOPE_CENTRE_FIT_EFFECT,
  PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_WIDTH_EFFECT,
  PHONOSCOPE_BG_SCALE_EFFECT,
  PHONOSCOPE_BG_FIT_EFFECT,
  PHONOSCOPE_BG_PROPORTIONAL_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
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
  // The centre image's base size, as percentages of the frame. Separate from the
  // scale above on purpose: this is how big the image IS, and the scale is a
  // multiplier a driver lane can sweep on top of it. A third of the frame is a
  // centrepiece rather than a backdrop, which is what a centre image wants to be.
  //
  // Width is authored and height follows it while `__centreProportional` is on,
  // which is the default and is what the slot did before it had a width at all.
  { id: PHONOSCOPE_CENTRE_WIDTH_EFFECT, min: 0, max: 100, step: 1, default: 33 },
  { id: PHONOSCOPE_CENTRE_HEIGHT_EFFECT, min: 0, max: 100, step: 1, default: 33 },
  // 0 manual, 1 fit to screen, 2 fill screen. Append-only.
  { id: PHONOSCOPE_CENTRE_FIT_EFFECT, min: 0, max: 2, step: 1, default: 0 },
  // On by default: keeping the source's proportions is what every centre image
  // authored before this axis existed was doing.
  { id: PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT, min: 0, max: 1, step: 1, default: 1 },
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
  // 1 is the identity, so an existing band is exactly the band it was. Shares
  // the centre scale's 0.1-5 bounds because it is the same kind of axis: a
  // multiplier on a slot's size that a driver lane sweeps.
  { id: PHONOSCOPE_BG_SCALE_EFFECT, min: 0.1, max: 5, step: 0.1, default: 1 },
  // 0 manual, 1 fit to screen, 2 fill screen. Append-only. Only meaningful when
  // the colour theme names a background image — a procedural field has no
  // proportions to fit — which is why the control is hidden until it does.
  { id: PHONOSCOPE_BG_FIT_EFFECT, min: 0, max: 2, step: 1, default: 0 },
  { id: PHONOSCOPE_BG_PROPORTIONAL_EFFECT, min: 0, max: 1, step: 1, default: 1 },
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
  // The same four for the background image, with the same ranges, defaults and
  // override-only rule. A backdrop and a centrepiece change at the same moment
  // but are not the same picture: dissolving one while the other slides is a
  // combination worth being able to author, and that needs its own axes.
  { id: PHONOSCOPE_BG_TRANSITION_EFFECT, min: 0, max: 2, step: 1, default: 0 },
  { id: PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT, min: 0, max: 360, step: 1, default: 0 },
  { id: PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT, min: 0, max: 10, step: 1, default: 0 },
  { id: PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT, min: 0, max: 1, step: 1, default: 0 },
];

const PICTURE_EFFECT_IDS = new Set(PHONOSCOPE_PICTURE_EFFECTS.map((effect) => effect.id));

export function isPicturePhonoscopeEffect(id: string) {
  return PICTURE_EFFECT_IDS.has(id);
}

/**
 * Human-facing labels for the "+ Add effect" picker. Module settings supply
 * their own label and `section`; these are the ones that have nowhere else to
 * come from.
 *
 * `shortLabel` is how the effect reads inside its group in
 * `phonoscope-effect-groups.ts`, where the heading already says "Glow" and
 * repeating it in every row is just noise.
 *
 * A `description` is the exception, not the rule: a label and nothing else,
 * unless the control is genuinely obtuse, in which case one short clause. The
 * mechanism belongs in a comment beside the declaration above, not in the
 * panel.
 */
export const PHONOSCOPE_PICTURE_EFFECT_LABELS: Record<
  string,
  { label: string; shortLabel?: string; description?: string }
> = {
  [PHONOSCOPE_GLOW_BLUR_EFFECT]: { label: "Glow blur", shortLabel: "Blur" },
  [PHONOSCOPE_GLOW_OPACITY_EFFECT]: { label: "Glow opacity", shortLabel: "Opacity" },
  [PHONOSCOPE_GLOW_OVERDRIVE_EFFECT]: { label: "Glow overdrive", shortLabel: "Overdrive" },
  [PHONOSCOPE_GLOW_CLAMP_EFFECT]: { label: "Glow clamp", shortLabel: "Clamp" },
  [PHONOSCOPE_GLOW_BLEND_EFFECT]: { label: "Glow blend mode", shortLabel: "Blend mode" },
  [PHONOSCOPE_MESSAGE_SCALE_EFFECT]: { label: "Centre scale", shortLabel: "Scale" },
  [PHONOSCOPE_CENTRE_WIDTH_EFFECT]: { label: "Centre width", shortLabel: "Width" },
  [PHONOSCOPE_CENTRE_HEIGHT_EFFECT]: { label: "Centre height", shortLabel: "Height" },
  [PHONOSCOPE_CENTRE_FIT_EFFECT]: { label: "Centre size mode", shortLabel: "Size mode" },
  [PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT]: { label: "Centre auto height", shortLabel: "Auto" },
  [PHONOSCOPE_HUE_OFFSET_EFFECT]: { label: "Random light hue offset" },
  [PHONOSCOPE_THEME_CHANGE_EFFECT]: { label: "Change colour theme" },
  [PHONOSCOPE_ALT_THEME_EFFECT]: { label: "Change to alt theme" },
  [PHONOSCOPE_BG_HEIGHT_EFFECT]: { label: "Background height", shortLabel: "Height" },
  [PHONOSCOPE_BG_WIDTH_EFFECT]: { label: "Background width", shortLabel: "Width" },
  [PHONOSCOPE_BG_SCALE_EFFECT]: { label: "Background scale", shortLabel: "Scale" },
  [PHONOSCOPE_BG_FIT_EFFECT]: { label: "Background size mode", shortLabel: "Size mode" },
  [PHONOSCOPE_BG_PROPORTIONAL_EFFECT]: {
    label: "Background auto height",
    shortLabel: "Auto",
  },
  [PHONOSCOPE_VIGNETTE_OPACITY_EFFECT]: { label: "Vignette opacity" },
  [PHONOSCOPE_VIGNETTE_SIZE_EFFECT]: { label: "Vignette size" },
  [PHONOSCOPE_SCENE_BLEND_EFFECT]: { label: "Particle blend mode", shortLabel: "Blend mode" },
  [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: { label: "Centre transition", shortLabel: "Transition" },
  [PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT]: {
    label: "Centre transition axis",
    shortLabel: "Axis",
    description: "0° horizontal, 90° vertical.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT]: {
    label: "Centre transition divisions",
    shortLabel: "Divisions",
    description: "Cuts across the axis; the sections travel in alternating directions.",
  },
  [PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT]: {
    label: "Centre transition return edge",
    shortLabel: "Return edge",
    description: "The section reverses instead of entering from the opposite edge.",
  },
  [PHONOSCOPE_BG_TRANSITION_EFFECT]: {
    label: "Background transition",
    shortLabel: "Transition",
  },
  [PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT]: {
    label: "Background transition axis",
    shortLabel: "Axis",
    description: "0° horizontal, 90° vertical.",
  },
  [PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT]: {
    label: "Background transition divisions",
    shortLabel: "Divisions",
    description: "Cuts across the axis; the sections travel in alternating directions.",
  },
  [PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT]: {
    label: "Background transition return edge",
    shortLabel: "Return edge",
    description: "The section reverses instead of entering from the opposite edge.",
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
