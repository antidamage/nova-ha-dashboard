import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "./types";
import { isRecord } from "./phonoscope/normalize-model";
import {
  lanesFromSources,
  legacyGlowBlendModeIndex,
  nextId,
  pictureLanes,
  resetPhonoscopeMigrationIds,
  themeChangeLane,
} from "./phonoscope-migrate-v3/lanes";

export { legacyGlowBlendModeIndex, resetPhonoscopeMigrationIds };

/**
 * One-shot migration from the pre-lane Phonoscope configuration.
 *
 * Before this, a setting had exactly one parameter source, colour themes owned
 * both their colours and a set of overrides, and rotation timing lived on the
 * colour group. Afterwards, behaviour lives in named settings groups made of
 * driver lanes, colours live in a flat theme library, and a colour group is an
 * ordered playlist pairing the two.
 *
 * The migration is deliberately behaviour-preserving: every theme becomes one
 * playlist entry in its original order, carrying the Default settings group
 * underneath its own, which is exactly what the old baseline-then-override
 * cascade meant.
 */

export const PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID = "default";

function slug(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z][a-z0-9_-]{1,63}$/.test(normalized) ? normalized : fallback;
}

export type PhonoscopeMigrationResult = {
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  houseParty: PhonoscopeHouseParty;
  structuralSettings: Record<string, number>;
  /** Set only when a pre-driver `blendMode` string was the stored choice. */
  glowBlendMode?: number;
};

/**
 * `raw` is `preferences.phonoscope` in its pre-lane shape. Returns the v3
 * shape; the caller decides whether to persist it.
 */
export function migratePhonoscopeToV3(raw: unknown): PhonoscopeMigrationResult {
  resetPhonoscopeMigrationIds();
  const source = isRecord(raw) ? raw : {};
  const activeModuleId = typeof source.activeModuleId === "string"
    ? source.activeModuleId
    : "particle-ripples";

  const legacyGroups = Array.isArray(source.colorGroups) ? source.colorGroups.filter(isRecord) : [];
  const selectedGroup = legacyGroups[0] ?? {};

  // The Default settings group: everything that applied regardless of theme.
  const baselineSources = isRecord(source.moduleParameterSources)
    && isRecord(source.moduleParameterSources[activeModuleId])
    ? source.moduleParameterSources[activeModuleId] as Record<string, unknown>
    : {};
  const defaultGroup: PhonoscopeSettingsGroup = {
    id: PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID,
    name: "Default",
    moduleId: activeModuleId,
    lanes: [
      ...lanesFromSources(baselineSources),
      ...pictureLanes(source),
      ...(legacyGroups.length ? [themeChangeLane(selectedGroup)] : []),
    ],
    combine: {},
    staticSettings: {},
    isDefault: true,
  };

  // Structural settings could never be driven, so they move across as values.
  const moduleSettings = isRecord(source.moduleSettings)
    && isRecord(source.moduleSettings[activeModuleId])
    ? source.moduleSettings[activeModuleId] as Record<string, unknown>
    : {};
  if (Number.isFinite(Number(moduleSettings.complexity))) {
    defaultGroup.staticSettings.complexity = Number(moduleSettings.complexity);
  }

  const settingsGroups: PhonoscopeSettingsGroup[] = [defaultGroup];
  const colorThemes: PhonoscopeColorTheme[] = [];
  const colorGroups: PhonoscopeColorGroup[] = [];
  const usedThemeIds = new Set<string>();
  const usedGroupIds = new Set<string>([PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID]);

  legacyGroups.forEach((rawGroup, groupIndex) => {
    const moduleId = typeof rawGroup.moduleId === "string" ? rawGroup.moduleId : activeModuleId;
    const themes = Array.isArray(rawGroup.themes) ? rawGroup.themes.filter(isRecord) : [];
    const entries: PhonoscopeColorGroupEntry[] = [];

    themes.forEach((rawTheme, themeIndex) => {
      const name = typeof rawTheme.name === "string" && rawTheme.name.trim()
        ? rawTheme.name.trim().slice(0, 60)
        : `Colour theme ${themeIndex + 1}`;
      let themeId = typeof rawTheme.id === "string" && rawTheme.id
        ? slug(rawTheme.id, `theme_${themeIndex + 1}`)
        : slug(name, `theme_${themeIndex + 1}`);
      while (usedThemeIds.has(themeId)) themeId = `${themeId}_${themeIndex + 1}`;
      usedThemeIds.add(themeId);
      colorThemes.push({
        id: themeId,
        name,
        moduleId,
        colors: isRecord(rawTheme.colors)
          ? rawTheme.colors as PhonoscopeColorTheme["colors"]
          : {},
        // Both image slots postdate the shape this migration reads from, so
        // there is never one to carry across.
        imageId: null,
        backgroundImageId: null,
      });

      // A theme that carried overrides becomes its own settings group, layered
      // on top of Default exactly as the old cascade applied it.
      const settingsGroupIds = [PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID];
      const overrides = isRecord(rawTheme.parameterOverrides)
        && isRecord(rawTheme.parameterOverrides[moduleId])
        ? rawTheme.parameterOverrides[moduleId] as Record<string, unknown>
        : {};
      const lanes = lanesFromSources(overrides);
      if (lanes.length) {
        let ownId = `${themeId}_settings`;
        while (usedGroupIds.has(ownId)) ownId = `${ownId}_x`;
        usedGroupIds.add(ownId);
        settingsGroups.push({
          id: ownId,
          name,
          moduleId,
          lanes,
          combine: {},
          staticSettings: {},
          isDefault: false,
        });
        settingsGroupIds.push(ownId);
      }
      entries.push({ id: nextId("entry"), themeId, settingsGroupIds });
    });

    colorGroups.push({
      id: typeof rawGroup.id === "string" && rawGroup.id
        ? slug(rawGroup.id, `group_${groupIndex + 1}`)
        : `group_${groupIndex + 1}`,
      moduleId,
      name: typeof rawGroup.name === "string" && rawGroup.name.trim()
        ? rawGroup.name.trim().slice(0, 60)
        : `Colour group ${groupIndex + 1}`,
      entries,
      genres: [],
      // The first group catches every track until genres are assigned by hand.
      isDefault: groupIndex === 0,
    });
  });

  const legacyBlend = legacyGlowBlendModeIndex(source);
  return {
    settingsGroups,
    colorThemes,
    colorGroups,
    ...(legacyBlend === null ? {} : { glowBlendMode: legacyBlend }),
    houseParty: {
      // The renderer only ever took House Party as a launch flag, so there is
      // no stored value to carry: true preserves what the stack actually does.
      enabled: true,
      hueMode: selectedGroup.housePartyHueMode === "complement" ? "complement" : "follow",
      brightnessMode: selectedGroup.housePartyBrightnessMode === "oppose"
        || selectedGroup.housePartyBrightnessMode === "ignore"
        ? selectedGroup.housePartyBrightnessMode
        : "follow",
    },
    structuralSettings: {},
  };
}
