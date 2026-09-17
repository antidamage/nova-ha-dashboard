import { afterEach, describe, expect, it } from "vitest";

import type { PhonoscopeDriver, PhonoscopePreferences, PhonoscopeSettingsGroup } from "../types";
import { resetPhonoscopeNowPlayingForTest, writePhonoscopeNowPlaying } from "../phonoscope-now-playing";
import {
  commandPhonoscopeTheme,
  readPhonoscopeThemeState,
  resetPhonoscopeThemeStateForTest,
} from "../phonoscope-theme-state";
import {
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  phonoscopeDriver,
} from "../phonoscope-drivers";
import { configWith, rotationGroup } from "./phonoscope-theme-state.fixtures";

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

// The store is created at module load with `changedAtMs` set to `Date.now()`,
// while `resetPhonoscopeThemeStateForTest` zeroes it. These suites used to run
// after an earlier block's `afterEach`, so they have always seen the zeroed
// store. Reset once here so that stays true now they lead their own file.
resetPhonoscopeThemeStateForTest();

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
