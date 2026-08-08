import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopeDriver, PhonoscopePreferences, PhonoscopeSettingsGroup } from "./types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "./phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "./phonoscope-theme-state";
import {
  PHONOSCOPE_ALT_THEME_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  phonoscopeDriver,
} from "./phonoscope-drivers";

/**
 * A settings group whose only job is to carry the rotation rule.
 *
 * The ramp is spelled out in full rather than left to inherit, because a
 * transition lasts attack + hold + release: leaving the attack to its 0.05
 * default would make every timing assertion below 50 ms out from the number it
 * names, for a reason that has nothing to do with what it is testing. The
 * all-in-the-release shape is also the one every configuration authored before
 * the ramp meant this had.
 */
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
        attackSeconds: 0,
        holdSeconds: 0,
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
  id, name: id, moduleId: "particle-ripples", colors: {},
  imageId: null, backgroundImageId: null,
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

/** A settings group carrying only the alt-theme flip rule. */
function altGroup(
  id: string,
  driver: Partial<PhonoscopeDriver>,
  releaseSeconds = 1,
): PhonoscopeSettingsGroup {
  return {
    id,
    name: id,
    moduleId: "particle-ripples",
    lanes: [{
      id: `${id}_lane`,
      driver: phonoscopeDriver(driver),
      modifiers: [],
      // Ramp spelled out for the same reason `rotationGroup` spells it out: the
      // transition lasts attack + hold + release, and these tests name exact
      // instants.
      bindings: [{
        id: `${id}_bind`,
        effect: PHONOSCOPE_ALT_THEME_EFFECT,
        attackSeconds: 0,
        holdSeconds: 0,
        releaseSeconds,
      }],
    }],
    combine: {},
    staticSettings: {},
    isDefault: id === "default",
  };
}

/**
 * `red` alts to `green`; `blue` deliberately has none, so it is the entry that
 * proves the state is the household's rather than the entry's.
 */
function altConfig(settingsGroups: PhonoscopeSettingsGroup[]): PhonoscopePreferences {
  const base = configWith(settingsGroups);
  return {
    ...base,
    colorGroups: [{
      ...base.colorGroups![0],
      entries: base.colorGroups![0].entries.map((entry) => entry.themeId === "red"
        ? { ...entry, altThemeId: "green" }
        : entry),
    }],
  };
}

describe("the alt colour theme", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  it("flips to the entry's alt, and flips back on the next firing", () => {
    const config = altConfig([altGroup("default", { type: "timer", intervalSeconds: 2 })]);
    expect(readPhonoscopeThemeState(config, 1_000)).toMatchObject({
      themeId: "red", altActive: false,
    });
    // Interval 2 + the 1s transition, exactly as the rotation reads its timer.
    expect(readPhonoscopeThemeState(config, 4_000)).toMatchObject({
      themeId: "green", altActive: true,
    });
    expect(readPhonoscopeThemeState(config, 7_000)).toMatchObject({
      themeId: "red", altActive: false,
    });
  });

  it("blends over the binding's release rather than cutting", () => {
    const config = altConfig([altGroup("default", { type: "timer", intervalSeconds: 2 }, 3)]);
    readPhonoscopeThemeState(config, 1_000);
    expect(readPhonoscopeThemeState(config, 6_000)).toMatchObject({
      themeId: "green", transitionSeconds: 3,
    });
  });

  it("bumps the revision so every client refetches the flip", () => {
    const config = altConfig([altGroup("default", { type: "timer", intervalSeconds: 2 })]);
    const before = readPhonoscopeThemeState(config, 1_000).revision;
    expect(readPhonoscopeThemeState(config, 4_000).revision).toBeGreaterThan(before);
  });

  it("is household state: an entry with no alt shows its own and leaves it on", () => {
    // Both pulses on the same song driver, so the rotation and the flip move
    // together — A → A-alt → B (no alt) → C-alt, the shape the feature is for.
    const config = altConfig([
      rotationGroup("default", { type: "song" }),
      altGroup("alt", { type: "song" }),
    ].map((group, index) => ({ ...group, isDefault: index === 0 })));
    const withBoth = {
      ...config,
      colorGroups: [{
        ...config.colorGroups![0],
        entries: config.colorGroups![0].entries.map((entry) => ({
          ...entry,
          settingsGroupIds: ["default", "alt"],
          // `green` alts back to `red`, so the third stop has an alt of its own.
          altThemeId: entry.themeId === "green" ? "red" : entry.altThemeId ?? null,
        })),
      }],
    };

    writePhonoscopeNowPlaying({ playing: true, track: { id: "a", title: "a", artist: "a" } }, 1_000);
    expect(readPhonoscopeThemeState(withBoth, 1_000).themeId).toBe("red");

    writePhonoscopeNowPlaying({ playing: true, track: { id: "b", title: "b", artist: "b" } }, 2_000);
    // The rotation moved to `blue`, which has no alt, and the state stayed on.
    expect(readPhonoscopeThemeState(withBoth, 2_000)).toMatchObject({
      themeId: "blue", altActive: true,
    });

    writePhonoscopeNowPlaying({ playing: true, track: { id: "c", title: "c", artist: "c" } }, 3_000);
    // Flipped off again by its own firing, so `green` shows its own colours.
    expect(readPhonoscopeThemeState(withBoth, 3_000)).toMatchObject({
      themeId: "green", altActive: false,
    });
  });

  it("holds under a pause, and does not fire the moment the pause is released", () => {
    const config = altConfig([altGroup("default", { type: "timer", intervalSeconds: 2 })]);
    readPhonoscopeThemeState(config, 1_000);
    commandPhonoscopeTheme(config, "pause", 1_100);
    expect(readPhonoscopeThemeState(config, 60_000)).toMatchObject({
      themeId: "red", altActive: false,
    });
    commandPhonoscopeTheme(config, "resume", 60_100);
    // The clock was kept under the hold, so the flip is still a full period away.
    expect(readPhonoscopeThemeState(config, 61_000).altActive).toBe(false);
    expect(readPhonoscopeThemeState(config, 63_100).altActive).toBe(true);
  });

  it("never fires from a level driver, which carries no event", () => {
    const config = altConfig([altGroup("default", { type: "energy" })]);
    readPhonoscopeThemeState(config, 1_000);
    expect(readPhonoscopeThemeState(config, 600_000)).toMatchObject({
      themeId: "red", altActive: false,
    });
  });
});

/**
 * A settings group that sets nothing but the centre-image transition axes, as
 * pinned values on a lane. The driver is immaterial — these are latched when a
 * transition starts, never sampled per frame.
 */
function transitionGroup(
  id: string,
  axes: Partial<Record<string, number>>,
  /** The ramp authored on the transition's own control set, if it has one. */
  ramp?: [number, number, number],
): PhonoscopeSettingsGroup {
  return {
    id,
    name: id,
    moduleId: "particle-ripples",
    lanes: [{
      id: `${id}_lane`,
      driver: phonoscopeDriver({ type: "beat" }),
      modifiers: [],
      bindings: Object.entries(axes).map(([effect, value]) => ({
        id: `${id}_${effect}`,
        effect,
        min: value as number,
        max: value as number,
        ...(ramp && effect === PHONOSCOPE_CENTRE_TRANSITION_EFFECT
          ? { attackSeconds: ramp[0], holdSeconds: ramp[1], releaseSeconds: ramp[2] }
          : {}),
      })),
    }],
    combine: {},
    staticSettings: {},
    isDefault: false,
  };
}

describe("the centre-image transition", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  /**
   * `red` carries a slide override; `blue` and `green` carry nothing, so they
   * cross-fade. The rotation rule itself lives in `default`, which every entry
   * lists, so the only thing that differs is HOW each entry leaves.
   */
  function perEntryConfig(): PhonoscopePreferences {
    const base = configWith([
      rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      transitionGroup("slide", {
        [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: 2,
        [PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT]: 90,
        [PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT]: 3,
        [PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT]: 1,
      }),
    ]);
    return {
      ...base,
      colorGroups: [{
        ...base.colorGroups![0],
        entries: base.colorGroups![0].entries.map((entry) => entry.themeId === "red"
          ? { ...entry, settingsGroupIds: ["default", "slide"] }
          : entry),
      }],
    };
  }

  it("lasts attack + hold + release, not the release alone", () => {
    const config = configWith([{
      ...rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      lanes: [{
        id: "l",
        driver: phonoscopeDriver({ type: "timer", intervalSeconds: 2 }),
        modifiers: [],
        bindings: [{
          id: "b",
          effect: PHONOSCOPE_THEME_CHANGE_EFFECT,
          attackSeconds: 0.5,
          holdSeconds: 0.25,
          releaseSeconds: 1,
        }],
      }],
    }]);
    readPhonoscopeThemeState(config, 1_000);
    // Interval 2 + the 1.75s transition.
    const advanced = readPhonoscopeThemeState(config, 4_750);
    expect(advanced.themeId).toBe("blue");
    expect(advanced.transitionSeconds).toBeCloseTo(1.75, 10);
    expect(advanced.transition).toMatchObject({
      attackSeconds: 0.5, holdSeconds: 0.25, releaseSeconds: 1,
    });
  });

  it("is owned by the entry the change STARTS from, not the one it lands on", () => {
    const config = perEntryConfig();
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");

    // Leaving `red`, which overrides to a slide: the transition is red's even
    // though the picture is arriving at `blue`, which overrides nothing.
    const leavingRed = readPhonoscopeThemeState(config, 4_000);
    expect(leavingRed.themeId).toBe("blue");
    expect(leavingRed.transition).toMatchObject({
      mode: 2, axisDegrees: 90, divisions: 3, returnFromOrigin: true,
    });

    // Leaving `blue`, which overrides nothing, cross-fades — the slide did not
    // stick to the rotation, it belonged to the entry that fired.
    const leavingBlue = readPhonoscopeThemeState(config, 7_000);
    expect(leavingBlue.themeId).toBe("green");
    expect(leavingBlue.transition).toMatchObject({
      mode: 0, axisDegrees: 0, divisions: 0, returnFromOrigin: false,
    });
  });

  it("takes the last settings group's value, so an override beats the defaults", () => {
    const base = configWith([
      rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      transitionGroup("base", { [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: 1 }),
      transitionGroup("override", { [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: 2 }),
    ]);
    const config = {
      ...base,
      colorGroups: [{
        ...base.colorGroups![0],
        entries: base.colorGroups![0].entries.map((entry) => ({
          ...entry,
          settingsGroupIds: ["default", "base", "override"],
        })),
      }],
    };
    readPhonoscopeThemeState(config, 1_000);
    expect(readPhonoscopeThemeState(config, 4_000).transition.mode).toBe(2);
  });

  it("wraps the axis rather than clamping it, so 360 is 0", () => {
    const base = configWith([
      rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      transitionGroup("axis", { [PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT]: 360 }),
    ]);
    const config = {
      ...base,
      colorGroups: [{
        ...base.colorGroups![0],
        entries: base.colorGroups![0].entries.map((entry) => ({
          ...entry, settingsGroupIds: ["default", "axis"],
        })),
      }],
    };
    readPhonoscopeThemeState(config, 1_000);
    expect(readPhonoscopeThemeState(config, 4_000).transition.axisDegrees).toBe(0);
  });

  it("takes its ramp from the transition's own control set, not from the pulse", () => {
    const base = configWith([
      // The pulse still says 1s, which is what it meant before the transition
      // carried its own ramp.
      rotationGroup("default", { type: "timer", intervalSeconds: 2 }),
      transitionGroup(
        "slide",
        { [PHONOSCOPE_CENTRE_TRANSITION_EFFECT]: 2 },
        [0.2, 0.1, 0.4],
      ),
    ]);
    const config = {
      ...base,
      colorGroups: [{
        ...base.colorGroups![0],
        entries: base.colorGroups![0].entries.map((entry) => ({
          ...entry, settingsGroupIds: ["default", "slide"],
        })),
      }],
    };
    readPhonoscopeThemeState(config, 1_000);
    const advanced = readPhonoscopeThemeState(config, 4_000);
    expect(advanced.transition).toMatchObject({
      attackSeconds: 0.2, holdSeconds: 0.1, releaseSeconds: 0.4, mode: 2,
    });
    expect(advanced.transitionSeconds).toBeCloseTo(0.7, 10);
  });

  it("keeps the pulse's envelope as the ramp when nothing binds a transition", () => {
    const config = configWith([rotationGroup("default", { type: "timer", intervalSeconds: 2 }, 0.6)]);
    readPhonoscopeThemeState(config, 1_000);
    const advanced = readPhonoscopeThemeState(config, 4_000);
    expect(advanced.transition).toMatchObject({
      attackSeconds: 0, holdSeconds: 0, releaseSeconds: 0.6,
    });
  });

  it("cuts under a solo lock rather than sliding a picture that is being held", () => {
    const config = { ...perEntryConfig(), soloColorThemeId: "red" };
    const state = readPhonoscopeThemeState(config, 1_000);
    expect(state.transitionSeconds).toBe(0);
    expect(state.transition.mode).toBe(0);
  });
});
