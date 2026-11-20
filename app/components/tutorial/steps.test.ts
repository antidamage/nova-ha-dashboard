import { describe, expect, it } from "vitest";
import { SCRIPT_PARTS } from "./finger/scripts";
import { CAPTION_MAX_CHARS, TUTORIAL_STEPS } from "./steps";

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe("tutorial steps", () => {
  it("keeps captions to two short sentences (alex's rule against verbose UX notes)", () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.caption.length, step.id).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
      expect(sentences(step.caption), step.id).toBeLessThanOrEqual(2);
    }
  });

  it("has unique ids and a script for every step", () => {
    expect(new Set(TUTORIAL_STEPS.map((step) => step.id)).size).toBe(TUTORIAL_STEPS.length);
    for (const step of TUTORIAL_STEPS) expect(SCRIPT_PARTS[step.script], step.id).toBeDefined();
  });

  it("covers what alex asked for, in teaching order", () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      "welcome", "tap-vs-turn", "light-brightness", "light-colour", "light-presets",
      "unlock", "target-and-modes", "fan-ring", "mode-ring", "fresh-and-timer",
      "orb", "advanced", "background",
    ]);
  });

  it("only drives a real control on the fold step; every other gesture plays on a copy", () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.script === "none") continue;
      if (step.id === "advanced") expect(step.copy).toBeNull();
      else expect(step.copy, step.id).not.toBeNull();
    }
  });
});
