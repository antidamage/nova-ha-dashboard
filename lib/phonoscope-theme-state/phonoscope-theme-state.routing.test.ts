import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopePreferences } from "../types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "../phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "../phonoscope-theme-state";
import { configWith, rotationGroup } from "./phonoscope-theme-state.fixtures";

// The store is created at module load with `changedAtMs` set to `Date.now()`,
// while `resetPhonoscopeThemeStateForTest` zeroes it. These suites used to run
// after an earlier block's `afterEach`, so they have always seen the zeroed
// store. Reset once here so that stays true now they lead their own file.
resetPhonoscopeThemeStateForTest();

describe("genre routing", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  const twoGroups = (chooseColorGroupByGenre: boolean): PhonoscopePreferences => ({
    ...configWith([rotationGroup("default", { type: "timer", intervalSeconds: 600 })]),
    chooseColorGroupByGenre,
    colorGroups: [
      {
        id: "house", moduleId: "particle-ripples", name: "House",
        entries: [{ id: "e_house", themeId: "red", settingsGroupIds: ["default"] }],
        genres: ["House", "Techno"], isDefault: false,
      },
      {
        id: "fallback", moduleId: "particle-ripples", name: "Fallback",
        entries: [{ id: "e_fallback", themeId: "blue", settingsGroupIds: ["default"] }],
        genres: [], isDefault: true,
      },
    ],
  });

  it("picks the group that claimed the track's genre", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100, genreNames: ["Techno"] },
    });
    expect(readPhonoscopeThemeState(twoGroups(true), 1_000).groupId).toBe("house");
  });

  it("matches a genre case-insensitively", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100, genreNames: ["house"] },
    });
    expect(readPhonoscopeThemeState(twoGroups(true), 1_000).groupId).toBe("house");
  });

  it("falls back to the default group when nobody claims the genre", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100, genreNames: ["Sea Shanty"] },
    });
    expect(readPhonoscopeThemeState(twoGroups(true), 1_000).groupId).toBe("fallback");
  });

  it("falls back to the default group when the track has no genre at all", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100 },
    });
    expect(readPhonoscopeThemeState(twoGroups(true), 1_000).groupId).toBe("fallback");
  });

  it("ignores genre entirely when the switch is off", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100, genreNames: ["Techno"] },
    });
    // No manual assignment for this module, so it lands on the default group.
    const config = { ...twoGroups(false), moduleColorGroupIds: {} };
    expect(readPhonoscopeThemeState(config, 1_000).groupId).toBe("fallback");
  });
});

describe("group stepping", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  /** Two multi-entry groups, so stepping sideways is visibly not stepping along. */
  const stepConfig = (overrides: Partial<PhonoscopePreferences> = {}): PhonoscopePreferences => ({
    ...configWith([rotationGroup("default", { type: "timer", intervalSeconds: 600 })]),
    moduleColorGroupIds: {},
    colorGroups: [
      {
        id: "house", moduleId: "particle-ripples", name: "House",
        entries: [
          { id: "e_house_1", themeId: "red", settingsGroupIds: ["default"] },
          { id: "e_house_2", themeId: "blue", settingsGroupIds: ["default"] },
        ],
        genres: ["Techno"], isDefault: false,
      },
      {
        id: "fallback", moduleId: "particle-ripples", name: "Fallback",
        entries: [
          { id: "e_fallback_1", themeId: "green", settingsGroupIds: ["default"] },
          { id: "e_fallback_2", themeId: "blue", settingsGroupIds: ["default"] },
        ],
        genres: [], isDefault: true,
      },
    ],
    ...overrides,
  });

  it("steps to the adjacent group and lands on its first entry", () => {
    const config = stepConfig();
    expect(readPhonoscopeThemeState(config, 1_000).groupId).toBe("fallback");
    const stepped = commandPhonoscopeTheme(config, "next-group", 1_100);
    expect(stepped.groupId).toBe("house");
    expect(stepped.entryId).toBe("e_house_1");
  });

  it("wraps, so the transport never dead-ends", () => {
    const config = stepConfig();
    expect(commandPhonoscopeTheme(config, "previous-group", 1_100).groupId).toBe("house");
    expect(commandPhonoscopeTheme(config, "previous-group", 1_200).groupId).toBe("fallback");
  });

  it("leaves the group's own rotation running, because only pause holds it", () => {
    const config = stepConfig();
    expect(commandPhonoscopeTheme(config, "next-group", 1_100).paused).toBe(false);
  });

  it("holds the stepped group against genre routing", () => {
    writePhonoscopeNowPlaying({
      playing: true, position: 1,
      track: { title: "t", artist: "a", duration: 100, genreNames: ["Techno"] },
    });
    const config = stepConfig({ chooseColorGroupByGenre: true });
    expect(readPhonoscopeThemeState(config, 1_000).groupId).toBe("house");
    expect(commandPhonoscopeTheme(config, "next-group", 1_100).groupId).toBe("fallback");
    expect(readPhonoscopeThemeState(config, 1_200).groupId).toBe("fallback");
  });

  it("drops the step once the config's own pick changes", () => {
    const config = stepConfig();
    expect(commandPhonoscopeTheme(config, "next-group", 1_100).groupId).toBe("house");
    const repicked = stepConfig({ moduleColorGroupIds: { "particle-ripples": "fallback" } });
    expect(readPhonoscopeThemeState(repicked, 1_200).groupId).toBe("fallback");
  });

  it("loses to the editor's preview pin, because authoring beats transport", () => {
    const config = stepConfig();
    expect(commandPhonoscopeTheme(config, "next-group", 1_100).groupId).toBe("house");
    const previewing = stepConfig({ editorPreviewColorGroupId: "fallback" });
    expect(readPhonoscopeThemeState(previewing, 1_200).groupId).toBe("fallback");
  });
});
