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
} from "../phonoscope-drivers";

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
