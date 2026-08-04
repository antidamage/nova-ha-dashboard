import { describe, expect, it } from "vitest";
import {
  envelopeDurations,
  sourceWithType,
  visualiserThemePreviewColors,
  visualiserThemePreviewGradient,
  type ModuleSetting,
  type ParameterSource,
} from "./PhonoscopeConfig";

const setting: ModuleSetting = {
  id: "intensity",
  label: "Intensity",
  min: 0,
  max: 10,
  step: 0.5,
  default: 5,
};

describe("Phonoscope parameter source conversion", () => {
  it("previews the visualiser background, dot, and glow primary colours", () => {
    expect(visualiserThemePreviewColors({
      backgroundPrimary: { rgb: [10, 20, 30], intensity: 100, opacity: 100, cursor: { x: 0, y: 0 } },
      dotPrimary: { rgb: [100, 80, 60], intensity: 50, opacity: 80, cursor: { x: 0, y: 0 } },
      glowPrimary: { rgb: [200, 100, 50], intensity: 25, opacity: 60, cursor: { x: 0, y: 0 } },
    })).toEqual({
      background: "rgb(10 20 30 / 1)",
      dot: "rgb(50 40 30 / 0.8)",
      glow: "rgb(50 25 13 / 0.6)",
    });
  });

  it("serializes the three-colour preview as a browser-valid gradient", () => {
    const gradient = visualiserThemePreviewGradient({
      backgroundPrimary: { rgb: [10, 20, 30], intensity: 100, opacity: 100, cursor: { x: 0, y: 0 } },
      dotPrimary: { rgb: [100, 80, 60], intensity: 50, opacity: 80, cursor: { x: 0, y: 0 } },
      glowPrimary: { rgb: [200, 100, 50], intensity: 25, opacity: 60, cursor: { x: 0, y: 0 } },
    });
    const swatch = document.createElement("span");
    swatch.style.background = gradient;

    expect(swatch.style.background).toContain("linear-gradient");
    expect(swatch.style.background).not.toBe("");
  });

  it("renders legacy or malformed envelope fields with safe defaults", () => {
    const legacy = {
      type: "bass",
      min: 1,
      max: 1.5,
      attackSeconds: 0.05,
      releaseSeconds: Number.NaN,
    } as unknown as Extract<ParameterSource, { attackSeconds: number }>;

    expect(envelopeDurations(legacy)).toEqual([0.05, 0, 0.6]);
  });

  it("preserves the configured range between reactive drivers", () => {
    const source: ParameterSource = {
      type: "beat",
      min: 2,
      max: 8,
      attackSeconds: 0.2,
      holdSeconds: 0,
      releaseSeconds: 1.4,
    };
    expect(sourceWithType(setting, source, "energy")).toEqual({
      ...source,
      type: "energy",
    });
  });

  it("preserves the configured range across random and reactive drivers", () => {
    const reactive: ParameterSource = {
      type: "bass",
      min: 1.5,
      max: 7.5,
      attackSeconds: 0.1,
      holdSeconds: 0,
      releaseSeconds: 0.8,
    };
    expect(sourceWithType(setting, reactive, "random")).toMatchObject({
      type: "random",
      min: 1.5,
      max: 7.5,
    });

    const random: ParameterSource = {
      type: "random",
      min: 2.5,
      max: 9,
      cadence: "bar",
      intervalSeconds: 6,
      transitionSeconds: 1.2,
    };
    expect(sourceWithType(setting, random, "treble")).toMatchObject({
      type: "treble",
      min: 2.5,
      max: 9,
    });
  });

  it("maps range maximum to manual and manual back to range maximum", () => {
    const ranged: ParameterSource = {
      type: "mid",
      min: 2,
      max: 8.5,
      attackSeconds: 0.05,
      holdSeconds: 0,
      releaseSeconds: 0.6,
    };
    expect(sourceWithType(setting, ranged, "manual")).toEqual({
      type: "manual",
      value: 8.5,
    });

    expect(sourceWithType(
      setting,
      { type: "manual", value: 8.5 },
      "downbeat",
    )).toMatchObject({
      type: "downbeat",
      min: 6.5,
      max: 8.5,
    });
  });

  it("gives a named-choice setting the full range when it starts being driven", () => {
    // The glow overlay's blend mode: two named choices on a 0-1 axis. Shrinking
    // the range towards the manual value the way a continuous setting does
    // would leave "Screen" driven between Screen and Screen.
    const blendMode: ModuleSetting = {
      id: "glowBlend",
      label: "Blend mode",
      control: "select",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      options: [
        { value: 0, label: "Screen" },
        { value: 1, label: "Multiply" },
      ],
    };
    expect(sourceWithType(blendMode, { type: "manual", value: 0 }, "beat")).toMatchObject({
      type: "beat",
      min: 0,
      max: 1,
    });
    expect(sourceWithType(blendMode, { type: "manual", value: 1 }, "random")).toMatchObject({
      type: "random",
      min: 0,
      max: 1,
    });
  });

  it("does not rebuild a source when its selected type is unchanged", () => {
    const source: ParameterSource = {
      type: "random",
      min: 3,
      max: 6,
      cadence: "song",
      intervalSeconds: 9,
      transitionSeconds: 2,
    };
    expect(sourceWithType(setting, source, "random")).toBe(source);
  });
});
