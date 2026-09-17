import type { PhonoscopeDriver, PhonoscopePreferences, PhonoscopeSettingsGroup } from "../types";
import { PHONOSCOPE_THEME_CHANGE_EFFECT, phonoscopeDriver } from "../phonoscope-drivers";

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
export function rotationGroup(
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

export const themes = ["red", "blue", "green"].map((id) => ({
  id, name: id, moduleId: "particle-ripples", colors: {},
  imageId: null, backgroundImageId: null,
}));

export function configWith(
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
export const intervalConfig = configWith([rotationGroup("default", { type: "timer", intervalSeconds: 2 })]);
