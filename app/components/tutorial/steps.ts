import type { LayerSetId } from "./layers/catalogue";

/**
 * The tour's steps, in order (specs/tutorial-mode.md, "Steps, in order").
 * Data only: what each step points at, which sandbox copy plays on it, which
 * gesture script the finger runs, and the caption. Captions are capped at two
 * short sentences (160 characters) by `steps.test.ts`.
 */

export type TutorialTargetKind = "help-button" | "light" | "aircon" | "orb" | "fold" | "page";
export type TutorialCopyKind = "light" | "aircon" | "orb" | null;
export type TutorialScriptId = "none" | "lights" | "aircon" | "orb-dial" | "fold-open";

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
    id: "lights",
    layers: "rotary",
    title: "Lights",
    caption: "Turning sets brightness, from wherever you grab the knob. A tap switches to hue, then saturation; turn each.",
    target: "light",
    copy: "light",
    script: "lights",
  },
  {
    id: "aircon",
    layers: "rotary",
    title: "Air conditioner",
    caption: "One tap unlocks it; turn for the target, tap to cycle Auto, Manual and Off. In Manual, drag each ring by its thumb.",
    target: "aircon",
    copy: "aircon",
    script: "aircon",
    aircon: { mode: "auto" },
  },
  {
    id: "orb",
    layers: "orb",
    title: "Status orb",
    caption: "The orb shows what's running, like this wash. Open it with a tap; a tap then turns the finish alert off or on.",
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
