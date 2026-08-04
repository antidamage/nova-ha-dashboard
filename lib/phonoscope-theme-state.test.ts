import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopePreferences } from "./types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "./phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "./phonoscope-theme-state";

const config: PhonoscopePreferences = {
  activeModuleId: "particle-ripples",
  moduleColorGroupIds: { "particle-ripples": "group" },
  colorGroups: [{
    id: "group",
    moduleId: "particle-ripples",
    name: "Test",
    order: "sequential",
    changeMode: "interval",
    waitSeconds: 2,
    transitionSeconds: 1,
    housePartyHueMode: "follow",
    housePartyBrightnessMode: "follow",
    themes: ["red", "blue", "green"].map((id) => ({
      id,
      name: id,
      colors: {},
      parameterOverrides: {},
    })),
  }],
};

describe("Nova-owned Phonoscope theme state", () => {
  afterEach(() => {
    resetPhonoscopeThemeStateForTest();
    resetPhonoscopeNowPlayingForTest();
  });

  it("keeps every reader on one interval-driven selection", () => {
    expect(readPhonoscopeThemeState(config, 1_000).themeId).toBe("red");
    expect(readPhonoscopeThemeState(config, 3_999).themeId).toBe("red");
    const advanced = readPhonoscopeThemeState(config, 4_000);
    expect(advanced.themeId).toBe("blue");
    expect(readPhonoscopeThemeState(config, 4_001)).toEqual(advanced);
  });

  it("applies skip and pause once in Nova rather than per client", () => {
    readPhonoscopeThemeState(config, 1_000);
    const skipped = commandPhonoscopeTheme(config, "next", 1_100);
    expect(skipped).toMatchObject({ themeId: "blue", paused: true });
    expect(readPhonoscopeThemeState(config, 20_000).themeId).toBe("blue");
    commandPhonoscopeTheme(config, "resume", 20_100);
    expect(readPhonoscopeThemeState(config, 23_100).themeId).toBe("green");
  });

  it("treats an editor preview as an edge and does not revert a remote skip", () => {
    const previewing = { ...config, editorPreviewColorGroupId: "group", editorPreviewColorThemeId: "blue" };
    expect(readPhonoscopeThemeState(previewing, 1_000).themeId).toBe("blue");
    expect(commandPhonoscopeTheme(previewing, "next", 1_100).themeId).toBe("green");
    expect(readPhonoscopeThemeState(previewing, 2_000).themeId).toBe("green");
  });

  it("uses Apple TV's master-clock bar for downbeat groups", () => {
    const downbeat = {
      ...config,
      colorGroups: config.colorGroups?.map((group) => ({ ...group, changeMode: "downbeat" as const })),
    };
    writePhonoscopeNowPlaying({ playing: true, position: 1, barIndex: 5 });
    expect(readPhonoscopeThemeState(downbeat, 1_000).themeId).toBe("red");
    writePhonoscopeNowPlaying({ playing: true, position: 2, barIndex: 6 });
    expect(readPhonoscopeThemeState(downbeat, 1_100).themeId).toBe("blue");
  });
});
