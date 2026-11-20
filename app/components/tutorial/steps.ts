import type { LayerSetId } from "./layers/catalogue";

/**
 * The tour's steps, in order (specs/tutorial-mode.md, "Steps, in order").
 * Data only: what each step points at, which sandbox copy plays on it, which
 * gesture script the finger runs, and the caption. Captions are capped at two
 * short sentences (160 characters) by `steps.test.ts`.
 */

export type TutorialTargetKind = "help-button" | "light" | "presets" | "aircon" | "orb" | "fold" | "page";
export type TutorialCopyKind = "light" | "presets" | "aircon" | "orb" | null;
export type TutorialScriptId =
  | "none"
  | "tap-then-turn"
  | "light-brightness"
  | "light-colour"
  | "presets"
  | "unlock"
  | "target-and-modes"
  | "fan-ring"
  | "mode-ring"
  | "fresh-and-timer"
  | "orb-dial"
  | "fold-open";

export type TutorialStep = {
  id: string;
  title: string;
  caption: string;
  target: TutorialTargetKind;
  copy: TutorialCopyKind;
  script: TutorialScriptId;
  /** The aircon copy's starting mode. */
  aircon?: { mode: "auto" | "manual" };
  /** The layer set "How was this control built?" opens on this step. */
  layers?: LayerSetId;
  /** A device feature the step needs; it is skipped when the feature is off. */
  requires?: "statusOrb" | "background";
};

export const CAPTION_MAX_CHARS = 160;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    title: "A quick tour",
    caption: "Watch each control being used, then try it yourself. Back and Next move through the tour; × closes it.",
    target: "help-button",
    copy: null,
    script: "none",
  },
  {
    id: "tap-vs-turn",
    layers: "rotary",
    title: "Tap or turn",
    caption: "A tap picks what the knob sets. Turning changes it, from wherever you grab it, like a real knob.",
    target: "light",
    copy: "light",
    script: "tap-then-turn",
  },
  {
    id: "light-brightness",
    layers: "rotary",
    title: "Brightness",
    caption: "Brightness is lit when the knob loads. The ring shows the light's colour.",
    target: "light",
    copy: "light",
    script: "light-brightness",
  },
  {
    id: "light-colour",
    layers: "rotary",
    title: "Colour",
    caption: "Tap for hue and turn it round the wheel. Tap again for saturation, from white to full colour.",
    target: "light",
    copy: "light",
    script: "light-colour",
  },
  {
    id: "light-presets",
    title: "Presets",
    caption: "The row under the dial: On, the zone's own presets in order, then Off.",
    target: "presets",
    copy: "presets",
    script: "presets",
  },
  {
    id: "unlock",
    layers: "rotary",
    title: "Unlocking a dial",
    caption: "Climate knobs lock when idle, so a brush can't change them. One tap unlocks; a drag or a long hold doesn't.",
    target: "aircon",
    copy: "aircon",
    script: "unlock",
    aircon: { mode: "auto" },
  },
  {
    id: "target-and-modes",
    layers: "rotary",
    title: "Target and modes",
    caption: "Turning sets the target. A tap cycles Auto, Manual and Off.",
    target: "aircon",
    copy: "aircon",
    script: "target-and-modes",
    aircon: { mode: "auto" },
  },
  {
    id: "fan-ring",
    layers: "rotary",
    title: "Fan ring",
    caption: "Each ring is dragged by its thumb. A press on the track away from the thumb does nothing.",
    target: "aircon",
    copy: "aircon",
    script: "fan-ring",
    aircon: { mode: "manual" },
  },
  {
    id: "mode-ring",
    layers: "rotary",
    title: "Mode ring",
    caption: "The Mode ring picks what the unit does: cool, fan or heat.",
    target: "aircon",
    copy: "aircon",
    script: "mode-ring",
    aircon: { mode: "manual" },
  },
  {
    id: "fresh-and-timer",
    layers: "rotary",
    title: "Fresh air and timer",
    caption: "A toggle ring flips on a tap. The timer counts down and then switches the unit off.",
    target: "aircon",
    copy: "aircon",
    script: "fresh-and-timer",
    aircon: { mode: "manual" },
  },
  {
    id: "orb",
    layers: "orb",
    title: "Status orb",
    caption: "The orb shows the most important thing first. Tap to open its stack, then turn through it.",
    target: "orb",
    copy: "orb",
    script: "orb-dial",
    requires: "statusOrb",
  },
  {
    id: "advanced",
    title: "Advanced",
    caption: "More settings live past the ADVANCED line. Pull past it to open.",
    target: "fold",
    copy: null,
    script: "fold-open",
  },
  {
    id: "background",
    layers: "background",
    title: "Background",
    caption: "The background is a live shader, drawn by the graphics card.",
    target: "page",
    copy: null,
    script: "none",
    requires: "background",
  },
];
