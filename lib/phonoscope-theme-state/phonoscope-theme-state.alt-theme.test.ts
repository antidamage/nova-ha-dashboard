import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopeDriver, PhonoscopePreferences, PhonoscopeSettingsGroup } from "../types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "../phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "../phonoscope-theme-state";
import {
  PHONOSCOPE_ALT_THEME_EFFECT,
  phonoscopeDriver,
} from "../phonoscope-drivers";
import { configWith, rotationGroup } from "./phonoscope-theme-state.fixtures";

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

// The store is created at module load with `changedAtMs` set to `Date.now()`,
// while `resetPhonoscopeThemeStateForTest` zeroes it. These suites used to run
// after an earlier block's `afterEach`, so they have always seen the zeroed
// store. Reset once here so that stays true now they lead their own file.
resetPhonoscopeThemeStateForTest();

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
