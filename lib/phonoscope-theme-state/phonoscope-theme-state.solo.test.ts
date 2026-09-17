import { afterEach, describe, expect, it } from "vitest";

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
