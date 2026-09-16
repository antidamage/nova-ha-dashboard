import { PHONOSCOPE_MODULE_ID } from "../phonoscope";
import { PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID } from "../phonoscope-migrate-v3";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "../types";
import { isRecord } from "./color-model";

/**
 * A colour group is the rotation playlist. Entries are validated against the
 * flat libraries they reference, and a theme may legitimately appear in several
 * entries with different settings groups — that is the whole point — so only
 * the entry ids are deduplicated.
 *
 * Genres are exclusive across groups. Conflicts resolve first-wins here; the
 * editor performs an explicit steal (removing the genre from its previous
 * owner) so the user's most recent assignment is the one that survives.
 */
export function normalizePhonoscopeColorGroups(
  value: unknown,
  themes: PhonoscopeColorTheme[],
  settingsGroups: PhonoscopeSettingsGroup[],
): PhonoscopeColorGroup[] {
  if (!Array.isArray(value)) return [];
  const themeIds = new Set(themes.map((theme) => theme.id));
  const settingsIds = new Set(settingsGroups.map((group) => group.id));
  const fallbackSettingsId = settingsGroups.find((group) => group.isDefault)?.id
    ?? settingsGroups[0]?.id
    ?? PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID;
  const groupIds = new Set<string>();
  const claimedGenres = new Set<string>();

  const groups = value.flatMap((raw, index): PhonoscopeColorGroup[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `group_${index + 1}`;
    if (groupIds.has(id)) return [];
    groupIds.add(id);

    const entryIds = new Set<string>();
    const entries = Array.isArray(raw.entries)
      ? raw.entries.flatMap((rawEntry, position): PhonoscopeColorGroupEntry[] => {
          if (!isRecord(rawEntry)) return [];
          const themeId = typeof rawEntry.themeId === "string" ? rawEntry.themeId : "";
          if (!themeIds.has(themeId)) return [];
          let entryId = typeof rawEntry.id === "string" && rawEntry.id.trim()
            ? rawEntry.id.trim().slice(0, 64)
            : `entry_${position + 1}`;
          while (entryIds.has(entryId)) entryId = `${entryId}_${position + 1}`;
          entryIds.add(entryId);
          const chosen = Array.isArray(rawEntry.settingsGroupIds)
            ? [...new Set(rawEntry.settingsGroupIds.filter(
                (entry): entry is string => typeof entry === "string" && settingsIds.has(entry)))]
            : [];
          // The alt is a link into the same library, so an id that no longer
          // resolves — or one pointing back at this entry's own theme, which
          // would be an alt that does nothing — is dropped rather than kept as
          // a dangling reference. The entry then simply has no alternative.
          const rawAlt = typeof rawEntry.altThemeId === "string" ? rawEntry.altThemeId : "";
          const altThemeId = rawAlt && rawAlt !== themeId && themeIds.has(rawAlt) ? rawAlt : null;
          return [{
            id: entryId,
            themeId,
            altThemeId,
            // An entry that names nothing usable still has to render, so it
            // falls back to the default settings group rather than going dark.
            settingsGroupIds: chosen.length ? chosen : [fallbackSettingsId],
          }];
        })
      : [];

    const genres = Array.isArray(raw.genres)
      ? [...new Set(raw.genres.flatMap((genre) => {
          if (typeof genre !== "string" || !genre.trim()) return [];
          const cleaned = genre.trim().slice(0, 48);
          const key = cleaned.toLowerCase();
          if (claimedGenres.has(key)) return [];
          claimedGenres.add(key);
          return [cleaned];
        }))]
      : [];

    return [{
      id,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Colour group ${index + 1}`,
      entries,
      genres,
      isDefault: raw.isDefault === true,
    }];
  });

  if (!groups.length) return groups;
  // Exactly one group catches tracks with no genre or an unclaimed one.
  const chosen = Math.max(0, groups.findIndex((group) => group.isDefault));
  groups.forEach((group, index) => { group.isDefault = index === chosen; });
  return groups;
}

export function normalizeHouseParty(value: unknown): PhonoscopeHouseParty {
  const raw = isRecord(value) ? value : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    hueMode: raw.hueMode === "complement" ? "complement" : "follow",
    brightnessMode: raw.brightnessMode === "oppose" || raw.brightnessMode === "ignore"
      ? raw.brightnessMode
      : "follow",
  };
}

/**
 * The settings group everything falls back to. It can never be deleted, so a
 * configuration that somehow lost it gets an empty one rather than a rotation
 * with nowhere to resolve.
 */
export function withDefaultSettingsGroup(
  groups: PhonoscopeSettingsGroup[],
  moduleId: string,
): PhonoscopeSettingsGroup[] {
  if (groups.some((group) => group.isDefault)) return groups;
  return [{
    id: PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID,
    name: "Default",
    moduleId,
    lanes: [],
    combine: {},
    staticSettings: {},
    isDefault: true,
  }, ...groups];
}

