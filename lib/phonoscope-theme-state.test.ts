import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopeDriver, PhonoscopePreferences, PhonoscopeSettingsGroup } from "./types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "./phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "./phonoscope-theme-state";
import { PHONOSCOPE_THEME_CHANGE_EFFECT, phonoscopeDriver } from "./phonoscope-drivers";

/** A settings group whose only job is to carry the rotation rule. */
function rotationGroup(
  id: string,
  driver: Partial<PhonoscopeDriver>,
  releaseSeconds = 1,
  order = 0,
): PhonoscopeSettingsGroup {
  return {
    id,
    name: id,
    moduleId: "particle-ripples",
    lanes: [{
      id: `${id}_lane`,
      driver: phonoscopeDriver(driver),
      modifiers: [],
      bindings: [{
        id: `${id}_bind`,
        effect: PHONOSCOPE_THEME_CHANGE_EFFECT,
        releaseSeconds,
        params: { order },
      }],
    }],
    combine: {},
    staticSettings: {},
    isDefault: id === "default",
  };
}

const themes = ["red", "blue", "green"].map((id) => ({
  id, name: id, moduleId: "particle-ripples", colors: {}, imageId: null,
}));

function configWith(
  settingsGroups: PhonoscopeSettingsGroup[],
  entrySettingsGroupIds: string[] = ["default"],
  overrides: Partial<PhonoscopePreferences> = {},
): PhonoscopePreferences {
  return {
    activeModuleId: "particle-ripples",
    moduleColorGroupIds: { "particle-ripples": "group" },
    settingsGroups,
    colorThemes: themes,
    colorGroups: [{
      id: "group",
      moduleId: "particle-ripples",
      name: "Test",
      entries: themes.map((theme) => ({
        id: `entry_${theme.id}`,
        themeId: theme.id,
        settingsGroupIds: entrySettingsGroupIds,
      })),
      genres: [],
      isDefault: true,
    }],
    ...overrides,
  };
}

// waitSeconds 2 + transition 1 reproduces the pre-lane interval group.
const intervalConfig = configWith([rotationGroup("default", { type: "timer", intervalSeconds: 2 })]);

describe("Nova-owned Phonoscope theme state", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  it("keeps every reader on one timer-driven selection", () => {
    expect(readPhonoscopeThemeState(intervalConfig, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(intervalConfig, 3_999).themeId).toBe("red");
    const advanced = readPhonoscopeThemeState(intervalConfig, 4_000);
    expect(advanced.themeId).toBe("blue");
    expect(readPhonoscopeThemeState(intervalConfig, 4_001)).toEqual(advanced);
  });

  it("reports the entry alongside the theme, because rotation indexes entries", () => {
    const state = readPhonoscopeThemeState(intervalConfig, 1_000);
    expect(state.entryId).toBe("entry_red");
    expect(state.entryIndex).toBe(0);
    expect(state.settingsGroupIds).toEqual(["default"]);
  });

  it("applies skip and pause once in Nova rather than per client", () => {
    readPhonoscopeThemeState(intervalConfig, 1_000);
    const skipped = commandPhonoscopeTheme(intervalConfig, "next", 1_100);
    expect(skipped).toMatchObject({ themeId: "blue", paused: true });
    expect(readPhonoscopeThemeState(intervalConfig, 20_000).themeId).toBe("blue");
    commandPhonoscopeTheme(intervalConfig, "resume", 20_100);
    expect(readPhonoscopeThemeState(intervalConfig, 23_100).themeId).toBe("green");
  });

  it("treats an editor preview as an edge and does not revert a remote skip", () => {
    const previewing = {
      ...intervalConfig,
      editorPreviewColorGroupId: "group",
      editorPreviewColorEntryId: "entry_blue",
    };
    expect(readPhonoscopeThemeState(previewing, 1_000).themeId).toBe("blue");
    expect(commandPhonoscopeTheme(previewing, "next", 1_100).themeId).toBe("green");
    expect(readPhonoscopeThemeState(previewing, 2_000).themeId).toBe("green");
  });

  it("uses Apple TV's master-clock bar for a downbeat driver", () => {
    const downbeat = configWith([rotationGroup("default", { type: "downbeat" })]);
    writePhonoscopeNowPlaying({ playing: true, position: 1, barIndex: 5 });
    expect(readPhonoscopeThemeState(downbeat, 1_000).themeId).toBe("red");
    writePhonoscopeNowPlaying({ playing: true, position: 2, barIndex: 6 });
    expect(readPhonoscopeThemeState(downbeat, 1_100).themeId).toBe("blue");
  });

  it("honours every on a downbeat driver", () => {
    const everyThird = configWith([rotationGroup("default", { type: "downbeat", every: 3 })]);
    writePhonoscopeNowPlaying({ playing: true, position: 1, barIndex: 1 });
    readPhonoscopeThemeState(everyThird, 1_000);
    for (let bar = 2; bar <= 3; bar += 1) {
      writePhonoscopeNowPlaying({ playing: true, position: bar, barIndex: bar });
      expect(readPhonoscopeThemeState(everyThird, 1_000 + bar).themeId).toBe("red");
    }
    // The third counted bar event is the one that fires.
    writePhonoscopeNowPlaying({ playing: true, position: 4, barIndex: 4 });
    expect(readPhonoscopeThemeState(everyThird, 1_004).themeId).toBe("blue");
  });

  it("pins the rotation when no settings group binds the theme-change effect", () => {
    const silent = configWith([{
      id: "default", name: "Default", moduleId: "particle-ripples", lanes: [], combine: {},
      staticSettings: {}, isDefault: true,
    }]);
    expect(readPhonoscopeThemeState(silent, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(silent, 900_000).themeId).toBe("red");
  });

  it("lets different entries rotate at different speeds", () => {
    // Entry one holds for 2s, and the group it lands on holds for 20s.
    const config = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
        rotationGroup("slow", { type: "timer", intervalSeconds: 20 })],
      ["default"],
    );
    config.colorGroups![0].entries[1].settingsGroupIds = ["slow"];
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(config, 4_000).themeId).toBe("blue");
    // Blue now runs the slow group, so the 3s cadence no longer applies.
    expect(readPhonoscopeThemeState(config, 7_000).themeId).toBe("blue");
    expect(readPhonoscopeThemeState(config, 25_100).themeId).toBe("green");
  });

  it("keeps looping past an entry whose own settings group binds nothing", () => {
    // Only the first entry names the rotating group; the other two name a group
    // with no lanes at all. Reading the rule from the current entry alone made
    // the playlist advance once and pin there forever, so a sequential rotation
    // stopped after one step instead of going round.
    const config = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
        {
          id: "silent", name: "Silent", moduleId: "particle-ripples", lanes: [], combine: {},
          staticSettings: {}, isDefault: false,
        }],
      ["default"],
    );
    config.colorGroups![0].entries[1].settingsGroupIds = ["silent"];
    config.colorGroups![0].entries[2].settingsGroupIds = ["silent"];
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(config, 4_000).themeId).toBe("blue");
    expect(readPhonoscopeThemeState(config, 7_000).themeId).toBe("green");
    // And round to the start again.
    expect(readPhonoscopeThemeState(config, 10_000).themeId).toBe("red");
  });

  it("loops the playlist on the default order", () => {
    // order 0 is loop: sequential, and round again at the end.
    const config = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }, 1, 0)]);
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(config, 4_000).themeId).toBe("blue");
    expect(readPhonoscopeThemeState(config, 7_000).themeId).toBe("green");
    expect(readPhonoscopeThemeState(config, 10_000).themeId).toBe("red");
  });

  it("holds on the last entry when the playlist plays once", () => {
    // order 2 is play once: sequential, then stop rather than wrapping.
    const config = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }, 1, 2)]);
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(config, 4_000).themeId).toBe("blue");
    expect(readPhonoscopeThemeState(config, 7_000).themeId).toBe("green");
    // The clock keeps running; the playlist does not.
    expect(readPhonoscopeThemeState(config, 10_000).themeId).toBe("green");
    expect(readPhonoscopeThemeState(config, 40_000).themeId).toBe("green");
  });

  it("still wraps a manual skip while playing once, so the transport cannot dead-end", () => {
    const config = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }, 1, 2)]);
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(commandPhonoscopeTheme(config, "next", 1_100).themeId).toBe("blue");
    expect(commandPhonoscopeTheme(config, "next", 1_200).themeId).toBe("green");
    expect(commandPhonoscopeTheme(config, "next", 1_300).themeId).toBe("red");
  });
});

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

describe("solo", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  it("stops the rotation, so the theme-change effect never fires while held", () => {
    const groups = [rotationGroup("default", { type: "timer", intervalSeconds: 2 })];
    const free = configWith(groups);
    // Unsoloed the timer advances past the first entry.
    expect(readPhonoscopeThemeState(free, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(free, 60_000).themeId).not.toBe("red");

    resetPhonoscopeThemeStateForTest();
    const held = configWith(groups, ["default"], { soloSettingsGroupId: "default" });
    const first = readPhonoscopeThemeState(held, 1_000);
    const later = readPhonoscopeThemeState(held, 60_000);
    expect(later.entryId).toBe(first.entryId);
    expect(later.themeId).toBe(first.themeId);
    expect(later.paused).toBe(true);
  });

  it("holds the published colour theme regardless of what the rotation selects", () => {
    const soloed = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 })],
      ["default"],
      { soloColorThemeId: "green" },
    );
    expect(readPhonoscopeThemeState(soloed, 1_000).themeId).toBe("green");
    // Well past the timer, so the rotation has moved underneath.
    expect(readPhonoscopeThemeState(soloed, 60_000).themeId).toBe("green");
  });

  it("replaces the entry's settings groups with the soloed one", () => {
    const groups = [
      rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      rotationGroup("hard", { type: "song" }),
    ];
    const state = readPhonoscopeThemeState(
      configWith(groups, ["default"], { soloSettingsGroupId: "hard" }), 1_000);
    expect(state.settingsGroupIds).toEqual(["hard"]);
  });

  it("cuts rather than cross-fades, because a lock is not a transition", () => {
    const soloed = configWith(
      [rotationGroup("default", { type: "timer", intervalSeconds: 2 }, 5)],
      ["default"],
      { soloColorThemeId: "blue" },
    );
    expect(readPhonoscopeThemeState(soloed, 1_000).transitionSeconds).toBe(0);
  });

  it("ignores a solo naming something that no longer exists", () => {
    const state = readPhonoscopeThemeState(
      configWith([rotationGroup("default", { type: "timer", intervalSeconds: 2 })], ["default"],
        { soloColorThemeId: "deleted", soloSettingsGroupId: "gone" }), 1_000);
    expect(state.themeId).toBe("red");
    expect(state.settingsGroupIds).toEqual(["default"]);
  });

  it("bumps the revision when a solo is switched on, so clients refetch", () => {
    const base = configWith([rotationGroup("default", { type: "song" })]);
    const before = readPhonoscopeThemeState(base, 1_000).revision;
    const after = readPhonoscopeThemeState(
      { ...base, soloColorThemeId: "blue" }, 1_100).revision;
    expect(after).toBeGreaterThan(before);
  });

  it("publishes both locks together, colour theme and settings", () => {
    const groups = [
      rotationGroup("default", { type: "song" }),
      rotationGroup("hard", { type: "song" }),
    ];
    const state = readPhonoscopeThemeState(
      configWith(groups, ["default"], {
        soloColorThemeId: "green",
        soloSettingsGroupId: "hard",
      }), 1_000);
    expect(state.themeId).toBe("green");
    expect(state.settingsGroupIds).toEqual(["hard"]);
  });
});
