import { afterEach, describe, expect, it } from "vitest";

import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "../phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "../phonoscope-theme-state";
import { configWith, intervalConfig, rotationGroup } from "./phonoscope-theme-state.fixtures";

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
