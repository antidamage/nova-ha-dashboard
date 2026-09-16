import type { PhonoscopeColorGroup, PhonoscopePreferences } from "../types";
import type { PhonoscopePlaybackOrder } from "../phonoscope-drivers";
import { store } from "./store";
import type { PhonoscopeThemeState } from "./types";

/** Every colour group belonging to the live module, in authored order. */
export function moduleColorGroups(config: PhonoscopePreferences): PhonoscopeColorGroup[] {
  const moduleId = config.activeModuleId ?? "";
  return (config.colorGroups ?? []).filter((group) => group.moduleId === moduleId);
}

/**
 * What the config itself says the group should be, as one comparable string.
 *
 * A stepped override is only meaningful relative to this: the moment any part
 * of it changes the user has picked a group by other means, and the override
 * must get out of the way rather than pin the old answer forever.
 */
export function configGroupPick(config: PhonoscopePreferences) {
  const moduleId = config.activeModuleId ?? "";
  return [
    moduleId,
    config.chooseColorGroupByGenre ? "genre" : "manual",
    config.moduleColorGroupIds?.[moduleId] ?? "",
  ].join("|");
}

/**
 * Which colour group is live.
 *
 * The editor's preview pin wins, then a remote group step, then genre routing
 * when it is switched on, then the manual per-module pick. A track with no
 * genre, or a genre no group has claimed, falls through to the group flagged
 * default — which is why exactly one group always carries that flag.
 */
export function activePhonoscopeColorGroup(
  config: PhonoscopePreferences,
  genreNames: string[] = [],
): PhonoscopeColorGroup | undefined {
  const groups = moduleColorGroups(config);
  if (!groups.length) return undefined;

  const previewId = config.editorPreviewColorGroupId?.trim();
  if (previewId) {
    const preview = groups.find((group) => group.id === previewId);
    if (preview) return preview;
  }

  if (store.groupOverrideId) {
    const stepped = store.groupOverrideBasePick === configGroupPick(config)
      ? groups.find((group) => group.id === store.groupOverrideId)
      : undefined;
    if (stepped) return stepped;
    // Stale: the config's pick moved on, or the group was deleted.
    store.groupOverrideId = "";
    store.groupOverrideBasePick = "";
  }

  if (config.chooseColorGroupByGenre) {
    const wanted = new Set(genreNames.map((genre) => genre.trim().toLowerCase()).filter(Boolean));
    if (wanted.size) {
      const claimed = groups.find((group) =>
        group.genres.some((genre) => wanted.has(genre.trim().toLowerCase())));
      if (claimed) return claimed;
    }
    return groups.find((group) => group.isDefault) ?? groups[0];
  }

  const manual = config.moduleColorGroupIds?.[config.activeModuleId ?? ""];
  return groups.find((group) => group.id === manual)
    ?? groups.find((group) => group.isDefault)
    ?? groups[0];
}

/**
 * The theme this entry shows right now.
 *
 * The alt state is global and the alt link is per entry, so "alt is on" and
 * "this entry has an alt" are separate questions: an entry with no alt keeps
 * its own theme rather than blanking, and the state stays on for the next entry
 * that does have one.
 */
function resolvedThemeId() {
  return store.altActive && store.entryAltThemeId ? store.entryAltThemeId : store.baseThemeId;
}

export function publicState(): PhonoscopeThemeState {
  const {
    groupId, entryId, entryIndex, altActive, settingsGroupIds, paused, revision, changedAtMs,
    transitionSeconds, transition, backgroundTransition,
  } = store;
  return {
    groupId, entryId, entryIndex, themeId: resolvedThemeId(), altActive,
    settingsGroupIds: [...settingsGroupIds], paused, revision, changedAtMs, transitionSeconds,
    transition: { ...transition },
    backgroundTransition: { ...backgroundTransition },
  };
}

/** The next index, or null when the playlist has finished and must stop. */
export function chooseIndex(
  current: number,
  count: number,
  direction: 1 | -1,
  order: PhonoscopePlaybackOrder,
): number | null {
  if (order === "shuffle" && count >= 3) {
    // Nova owns randomness too. Avoid selecting the current item so every skip
    // command has a visible result on every client.
    const offset = 1 + Math.floor(Math.random() * (count - 1));
    return (current + direction * offset + count * 2) % count;
  }
  const next = current + direction;
  // Play once: run to the end and hold there. Deliberately only for the
  // automatic advance — a manual skip is an explicit instruction and still
  // wraps, or the transport would dead-end with no way back.
  if (order === "once" && (next >= count || next < 0)) return null;
  return (next + count) % count;
}

