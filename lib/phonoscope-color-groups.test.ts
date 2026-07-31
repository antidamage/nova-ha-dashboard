import { describe, expect, it } from "vitest";
import {
  migrateLegacyPhonoscopeColorGroups,
  normalizePhonoscopeColorGroups,
} from "./phonoscope-store";

describe("Phonoscope independent colour groups", () => {
  it("normalizes the reusable tree, required colours, and parameter sources", () => {
    const group = normalizePhonoscopeColorGroups([{
      id: "night",
      name: "Night",
      themes: [{
        id: "pulse",
        name: "Pulse",
        colors: { primary: { rgb: [300, 20, -5], intensity: 125 } },
        parameterOverrides: {
          "particle-ripples": {
            intensity: {
              type: "random",
              min: 1.5,
              max: 0.5,
              cadence: "interval",
              intervalSeconds: 0,
              transitionSeconds: 99,
            },
          },
        },
      }],
    }])[0]!;

    expect(group.themes[0]?.colors.dotPrimary).toMatchObject({
      rgb: [255, 20, 0],
      intensity: 100,
      opacity: 100,
    });
    expect(group.moduleId).toBe("particle-ripples");
    expect(group.themes[0]?.colors.primary).toBeUndefined();
    expect(group.themes[0]?.colors.linePrimary.opacity).toBe(42);
    expect(group.themes[0]?.colors.primaryText).toBeDefined();
    expect(group.themes[0]?.colors.secondaryText).toBeDefined();
    expect(group.themes[0]?.parameterOverrides["particle-ripples"]?.intensity).toEqual({
      type: "random",
      min: 1.5,
      max: 1.5,
      cadence: "interval",
      intervalSeconds: 0.25,
      transitionSeconds: 10,
    });
  });

  it("converts legacy dashboard themes without carrying genres or variants", () => {
    const groups = migrateLegacyPhonoscopeColorGroups([{
      id: "legacy",
      moduleId: "particle-ripples",
      name: "Legacy",
      useGenres: true,
      themes: [{
        themeId: "neon",
        baseVariant: "dark",
        swapOnDownbeat: true,
        genres: ["Rock"],
      }],
      order: "shuffle",
      changeMode: "song",
      waitSeconds: 30,
      transitionSeconds: 2,
    }], {
      entries: [{
        id: "neon",
        name: "Neon",
        themeSet: {
          themes: {
            dark: {
              accent: { rgb: [10, 20, 30], intensity: 100 },
              highlight: { rgb: [110, 120, 130], intensity: 100 },
              background: { rgb: [1, 2, 3], intensity: 100 },
              clockColor: { rgb: [240, 230, 220], intensity: 100 },
            },
          },
        },
      }],
    });

    expect(groups[0]).toMatchObject({
      id: "legacy",
      order: "shuffle",
      changeMode: "song",
      themes: [{
        id: "neon",
        name: "Neon",
        colors: {
          primaryText: { rgb: [240, 230, 220] },
          dotPrimary: { rgb: [10, 20, 30] },
          dotSecondary: { rgb: [110, 120, 130] },
        },
        parameterOverrides: {},
      }],
    });
    expect(JSON.stringify(groups)).not.toContain("genres");
    expect(JSON.stringify(groups)).not.toContain("baseVariant");
    expect(JSON.stringify(groups)).not.toContain("swapOnDownbeat");
  });
});
