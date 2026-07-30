import { describe, expect, it } from "vitest";
import { normalizePhonoscopeThemeGroups } from "./phonoscope-store";

describe("normalizePhonoscopeThemeGroups", () => {
  it("normalizes sequencing, variants, genres, and timing", () => {
    expect(normalizePhonoscopeThemeGroups([{
      id: "heavy",
      name: "Heavy rotation",
      useGenres: true,
      order: "shuffle",
      changeMode: "song",
      waitSeconds: 999,
      transitionSeconds: -2,
      themes: [{
        themeId: "v",
        baseVariant: "light",
        swapOnDownbeat: true,
        genres: ["Metal", "Metal", " Hyperpop "],
      }],
    }])).toEqual([{
      id: "heavy",
      name: "Heavy rotation",
      useGenres: true,
      order: "shuffle",
      changeMode: "song",
      waitSeconds: 600,
      transitionSeconds: 0,
      housePartyHueMode: "follow",
      housePartyBrightnessMode: "follow",
      themes: [{
        themeId: "v",
        baseVariant: "light",
        swapOnDownbeat: true,
        genres: ["Metal", "Hyperpop"],
      }],
    }]);
  });

  it("defaults genre matching on for existing groups with genre assignments", () => {
    expect(normalizePhonoscopeThemeGroups([{
      id: "existing",
      themes: [{ themeId: "v", genres: ["Rock"] }],
    }])[0]?.useGenres).toBe(true);
  });

  it("preserves an explicit choice not to use assigned genres", () => {
    expect(normalizePhonoscopeThemeGroups([{
      id: "disabled",
      useGenres: false,
      themes: [{ themeId: "v", genres: ["Rock"] }],
    }])[0]?.useGenres).toBe(false);
  });

  it("preserves downbeat-driven whole-theme changes", () => {
    expect(normalizePhonoscopeThemeGroups([{
      id: "downbeats",
      changeMode: "downbeat",
      themes: [{ themeId: "v" }],
    }])[0]?.changeMode).toBe("downbeat");
  });

  it("drops malformed and duplicate groups", () => {
    expect(normalizePhonoscopeThemeGroups([
      { id: "same", themes: [] },
      { id: "same", themes: [] },
      null,
    ])).toHaveLength(1);
  });
});
