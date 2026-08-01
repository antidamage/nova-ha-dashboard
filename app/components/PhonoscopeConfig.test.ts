import { describe, expect, it } from "vitest";
import {
  sourceWithType,
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
