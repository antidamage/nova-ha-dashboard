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
      "welcome", "lights", "aircon", "orb", "advanced", "theme", "background",
    ]);
  });

  it("keeps the theme step's mode captions to the same caps, one per mode in the button's order", async () => {
    const { THEME_CYCLE } = await import("./useThemeCycle");
    expect(THEME_CYCLE.map((entry) => entry.mode)).toEqual(["unset", "auto", "light", "dark"]);
    for (const entry of THEME_CYCLE) {
      expect(entry.say.length).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
      expect(sentences(entry.say)).toBeLessThanOrEqual(2);
    }
  });

  it("only drives a real control on the fold step; every other gesture plays on a copy", () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.script === "none") continue;
      if (step.id === "advanced") expect(step.copy).toBeNull();
      else expect(step.copy, step.id).not.toBeNull();
    }
  });

  it("keeps every phase caption to the same caps", () => {
    for (const [id, parts] of Object.entries(SCRIPT_PARTS)) {
      for (const part of parts) {
        if (typeof part === "function") continue;
        expect(part.say.length, id).toBeLessThanOrEqual(CAPTION_MAX_CHARS);
        expect(sentences(part.say), id).toBeLessThanOrEqual(2);
      }
    }
  });
});