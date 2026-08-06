import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  migratePhonoscopeToV3,
  PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID,
} from "./phonoscope-migrate-v3";
import {
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
} from "./phonoscope-drivers";

function liveConfig() {
  const raw = readFileSync(
    path.join(process.cwd(), "config", "dashboard-preferences.default.json"), "utf8");
  return JSON.parse(raw).phonoscope as Record<string, unknown>;
}

describe("migratePhonoscopeToV3 over the real configuration", () => {
  const result = migratePhonoscopeToV3(liveConfig());

  it("creates exactly one default settings group", () => {
    const defaults = result.settingsGroups.filter((group) => group.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID);
  });

  it("groups baseline sources by driver rather than one lane per setting", () => {
    const base = result.settingsGroups[0];
    // The live baseline drives intensity from the beat, offset_magnifier and
    // strong_beat_multiplier from the bass, and trail_length from energy — so
    // bass carries two effects in a single lane.
    const bass = base.lanes.find((lane) => lane.driver.type === "bass");
    expect(bass?.bindings.map((binding) => binding.effect).sort())
      .toEqual(["offset_magnifier", "strong_beat_multiplier"]);
    expect(base.lanes.find((lane) => lane.driver.type === "beat")?.bindings
      .map((binding) => binding.effect)).toEqual(["intensity"]);
    expect(base.lanes.find((lane) => lane.driver.type === "energy")?.bindings
      .map((binding) => binding.effect)).toEqual(["trail_length"]);
  });

  it("preserves each driven range and envelope", () => {
    const base = result.settingsGroups[0];
    const trail = base.lanes
      .flatMap((lane) => lane.bindings)
      .find((binding) => binding.effect === "trail_length");
    expect(trail).toMatchObject({ min: 0, max: 75.5, attackSeconds: 0.05 });
    expect(trail?.releaseSeconds).toBeCloseTo(5.05, 5);
  });

  it("drops manual sources, which the module manifest defaults now carry", () => {
    const effects = result.settingsGroups
      .flatMap((group) => group.lanes)
      .flatMap((lane) => lane.bindings)
      .map((binding) => binding.effect);
    // peak_threshold, anticipation, ramp_up and peak_glow were all manual.
    expect(effects).not.toContain("peak_threshold");
    expect(effects).not.toContain("anticipation");
    expect(effects).not.toContain("ramp_up");
  });

  it("moves complexity to the default group's static settings", () => {
    expect(result.settingsGroups[0].staticSettings.complexity).toBe(1);
  });

  it("turns the group's rotation controls into a themeChange binding", () => {
    const binding = result.settingsGroups[0].lanes
      .flatMap((lane) => lane.bindings)
      .find((entry) => entry.effect === PHONOSCOPE_THEME_CHANGE_EFFECT);
    expect(binding).toBeDefined();
    const lane = result.settingsGroups[0].lanes
      .find((entry) => entry.bindings.some((b) => b.effect === PHONOSCOPE_THEME_CHANGE_EFFECT));
    // The live group rotates on a 20 second interval with a 5 second fade.
    expect(lane?.driver.type).toBe("timer");
    expect(lane?.driver.intervalSeconds).toBe(20);
    expect(binding?.releaseSeconds).toBe(5);
    // Shuffle, carried onto the effect where the dropdown now lives.
    expect(binding?.params?.order).toBe(1);
  });

  it("gives every legacy theme one playlist entry, in order, layered over Default", () => {
    const group = result.colorGroups[0];
    expect(group.entries).toHaveLength(result.colorThemes.length);
    const names = group.entries.map((entry) =>
      result.colorThemes.find((theme) => theme.id === entry.themeId)?.name);
    expect(names).toEqual(["Hyperpop", "Battletech", "Golden Brown", "Evil Red", "Shadow"]);
    for (const entry of group.entries) {
      expect(entry.settingsGroupIds[0]).toBe(PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID);
    }
  });

  const entryNamed = (name: string) => {
    const theme = result.colorThemes.find((entry) => entry.name === name);
    return result.colorGroups[0].entries.find((entry) => entry.themeId === theme?.id);
  };

  it("promotes a theme's overrides into its own settings group layered on top", () => {
    const hyperpop = entryNamed("Hyperpop");
    expect(hyperpop?.settingsGroupIds).toHaveLength(2);
    const own = result.settingsGroups.find((entry) => entry.id === hyperpop?.settingsGroupIds[1]);
    expect(own?.name).toBe("Hyperpop");
    expect(own?.isDefault).toBe(false);
    expect(own?.lanes.flatMap((lane) => lane.bindings).map((binding) => binding.effect))
      .toContain("trail_length");
  });

  it("leaves a theme with no overrides pointing only at Default", () => {
    expect(entryNamed("Shadow")?.settingsGroupIds)
      .toEqual([PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID]);
  });

  it("keeps colour themes flat, with no behaviour on them", () => {
    for (const theme of result.colorThemes) {
      // A theme carries colour and the picture's centrepiece, and nothing else:
      // behaviour lives in settings groups, which the playlist entry names
      // alongside it. `imageId` postdates the shape this migration reads from,
      // so it is always null here.
      expect(Object.keys(theme)).toEqual(["id", "name", "moduleId", "colors", "imageId"]);
      expect(theme.imageId).toBeNull();
      expect(Object.keys(theme.colors).length).toBeGreaterThan(0);
    }
    // Ids are unique across the flat library.
    expect(new Set(result.colorThemes.map((theme) => theme.id)).size)
      .toBe(result.colorThemes.length);
  });

  it("flags exactly one colour group as the genre fallback", () => {
    expect(result.colorGroups.filter((group) => group.isDefault)).toHaveLength(1);
  });

  it("lifts house party hue and brightness to the household level", () => {
    expect(result.houseParty.hueMode).toBe("follow");
    expect(result.houseParty.brightnessMode).toBe("ignore");
    expect(result.houseParty.enabled).toBe(true);
  });
});

describe("migratePhonoscopeToV3 edge cases", () => {
  it("survives an empty configuration", () => {
    const result = migratePhonoscopeToV3({});
    expect(result.settingsGroups).toHaveLength(1);
    expect(result.settingsGroups[0].lanes).toEqual([]);
    expect(result.colorGroups).toEqual([]);
    expect(result.colorThemes).toEqual([]);
  });

  it("carries a driven glow overlay across as a picture lane", () => {
    const result = migratePhonoscopeToV3({
      activeModuleId: "particle-ripples",
      glowOverlay: {
        opacitySource: {
          type: "downbeat", min: 0, max: 80, attackSeconds: 0.1, holdSeconds: 0.2,
          releaseSeconds: 0.9,
        },
      },
    });
    const binding = result.settingsGroups[0].lanes
      .flatMap((lane) => lane.bindings)
      .find((entry) => entry.effect === PHONOSCOPE_GLOW_OPACITY_EFFECT);
    expect(binding).toMatchObject({ min: 0, max: 80, holdSeconds: 0.2, releaseSeconds: 0.9 });
  });

  it("reads a pre-driver blendMode string as its position on the mode axis", () => {
    // The axis is append-only, so these indices are a contract: 0 screen,
    // 1 multiply, 2 overlay.
    expect(migratePhonoscopeToV3({ glowOverlay: { blendMode: "screen" } }).glowBlendMode).toBe(0);
    expect(migratePhonoscopeToV3({ glowOverlay: { blendMode: "multiply" } }).glowBlendMode).toBe(1);
    expect(migratePhonoscopeToV3({ glowOverlay: { blendMode: "overlay" } }).glowBlendMode).toBe(2);
    // An unrecognised name is not a mode, so nothing is carried across.
    expect(migratePhonoscopeToV3({ glowOverlay: { blendMode: "hard-light" } }).glowBlendMode)
      .toBeUndefined();
    // A driven blend mode wins: it is a lane, not a fixed choice.
    expect(migratePhonoscopeToV3({
      glowOverlay: { blendMode: "multiply", blendModeSource: { type: "beat", min: 0, max: 2 } },
    }).glowBlendMode).toBeUndefined();
  });

  it("maps the retired random cadences onto their driver equivalents", () => {
    const result = migratePhonoscopeToV3({
      activeModuleId: "m",
      moduleParameterSources: {
        m: {
          a: { type: "random", cadence: "bar", min: 0, max: 1 },
          b: { type: "random", cadence: "interval", intervalSeconds: 9, min: 0, max: 1 },
        },
      },
    });
    const cadences = result.settingsGroups[0].lanes.map((lane) => lane.driver.cadence);
    expect(cadences).toContain("downbeat");
    expect(cadences).toContain("timer");
  });
});
