import type { PhonoscopeColorGroup, PhonoscopePreferences, PhonoscopeSettingsGroup } from "./types";
import { readPhonoscopeNowPlaying, trackKey } from "./phonoscope-now-playing";
import {
  driverFiresOn,
  mergePhonoscopeSettingsGroups,
  phonoscopePlaybackOrder,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  type PhonoscopePlaybackOrder,
} from "./phonoscope-drivers";

export type PhonoscopeThemeState = {
  groupId: string;
  /** The playlist entry that is live. Rotation indexes entries, not themes. */
  entryId: string;
  entryIndex: number;
  /** The entry's colour theme, carried alongside so clients can resolve a palette. */
  themeId: string;
  /** The entry's settings groups, in order. Merged by lanes-stack/scalars-layer. */
  settingsGroupIds: string[];
  paused: boolean;
  revision: number;
  changedAtMs: number;
  transitionSeconds: number;
};

type ThemeStore = PhonoscopeThemeState & {
  lastTrackKey: string;
  lastBarIndex: number | null;
  /** Counts song and downbeat events so a driver's `every` can gate them. */
  songEventCount: number;
  barEventCount: number;
  observedPreviewEntryId: string;
  previewActive: boolean;
  observedSoloThemeId: string;
  observedSoloSettingsGroupId: string;
};

const globalWithThemeState = globalThis as typeof globalThis & {
  __novaPhonoscopeThemeState?: ThemeStore;
};

const emptyStore = (): ThemeStore => ({
  groupId: "",
  entryId: "",
  entryIndex: 0,
  themeId: "",
  settingsGroupIds: [],
  paused: false,
  revision: 0,
  changedAtMs: Date.now(),
  transitionSeconds: 0,
  lastTrackKey: "",
  lastBarIndex: null,
  songEventCount: 0,
  barEventCount: 0,
  observedPreviewEntryId: "",
  previewActive: false,
  observedSoloThemeId: "",
  observedSoloSettingsGroupId: "",
});

const store = globalWithThemeState.__novaPhonoscopeThemeState ??
  (globalWithThemeState.__novaPhonoscopeThemeState = emptyStore());

/**
 * Which colour group is live.
 *
 * The editor's preview pin wins, then genre routing when it is switched on,
 * then the manual per-module pick. A track with no genre, or a genre no group
 * has claimed, falls through to the group flagged default — which is why
 * exactly one group always carries that flag.
 */
export function activePhonoscopeColorGroup(
  config: PhonoscopePreferences,
  genreNames: string[] = [],
): PhonoscopeColorGroup | undefined {
  const moduleId = config.activeModuleId ?? "";
  const groups = (config.colorGroups ?? []).filter((group) => group.moduleId === moduleId);
  if (!groups.length) return undefined;

  const previewId = config.editorPreviewColorGroupId?.trim();
  if (previewId) {
    const preview = groups.find((group) => group.id === previewId);
    if (preview) return preview;
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

  const manual = config.moduleColorGroupIds?.[moduleId];
  return groups.find((group) => group.id === manual)
    ?? groups.find((group) => group.isDefault)
    ?? groups[0];
}

function publicState(): PhonoscopeThemeState {
  const {
    groupId, entryId, entryIndex, themeId, settingsGroupIds, paused, revision, changedAtMs,
    transitionSeconds,
  } = store;
  return {
    groupId, entryId, entryIndex, themeId, settingsGroupIds: [...settingsGroupIds], paused,
    revision, changedAtMs, transitionSeconds,
  };
}

/** The next index, or null when the playlist has finished and must stop. */
function chooseIndex(
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

function themeChangeRuleFor(config: PhonoscopePreferences, settingsGroupIds: string[]) {
  const byId = new Map((config.settingsGroups ?? []).map((group) => [group.id, group]));
  const groups = settingsGroupIds
    .map((id) => byId.get(id))
    .filter((group): group is PhonoscopeSettingsGroup => Boolean(group));
  const merged = mergePhonoscopeSettingsGroups(groups);
  for (const { lane } of merged.lanes) {
    const binding = lane.bindings.find((entry) => entry.effect === PHONOSCOPE_THEME_CHANGE_EFFECT);
    if (binding) return { driver: lane.driver, binding };
  }
  return null;
}

/**
 * The `__themeChange` binding that governs rotation.
 *
 * Preferably the one the *current* entry names, so different entries can hold
 * for different lengths. Failing that, the first one anywhere on the playlist.
 *
 * That fallback is what makes the rotation a loop. Reading the current entry
 * alone meant a playlist where only some entries bound `__themeChange` advanced
 * onto an entry that bound nothing and then pinned there forever — the rotation
 * ran once and stopped, which is not what a sequential playlist means. An entry
 * with no binding of its own now inherits the playlist's, so it holds for that
 * long and moves on.
 */
function themeChangeRule(
  config: PhonoscopePreferences,
  entrySettingsGroupIds: string[],
  group?: PhonoscopeColorGroup,
) {
  const own = themeChangeRuleFor(config, entrySettingsGroupIds);
  if (own || !group) return own;
  for (const entry of group.entries) {
    const inherited = themeChangeRuleFor(config, entry.settingsGroupIds);
    if (inherited) return inherited;
  }
  return null;
}

function select(group: PhonoscopeColorGroup, index: number, now: number, transitionSeconds: number) {
  if (!group.entries.length) return;
  store.entryIndex = (index + group.entries.length) % group.entries.length;
  const entry = group.entries[store.entryIndex];
  store.entryId = entry.id;
  store.themeId = entry.themeId;
  store.settingsGroupIds = [...entry.settingsGroupIds];
  store.changedAtMs = now;
  store.transitionSeconds = transitionSeconds;
  store.revision += 1;
}

/**
 * Solo locks the published state to one colour theme and/or one settings group.
 *
 * A lock stops the rotation outright: `__themeChange` does not fire and the
 * playlist does not advance while anything is soloed. Overriding only the
 * published ids was not enough — both engines resolve their palette from the
 * *entry* they were told to show, so the rotation kept moving underneath and
 * the lock had no visible effect. The engines force-load a soloed theme from
 * `soloColorThemeId` in the config; the settings lock rides the published
 * `settingsGroupIds`, which they already follow.
 */
function resolveSolo(config: PhonoscopePreferences) {
  const themeId = config.soloColorThemeId
    && (config.colorThemes ?? []).some((theme) => theme.id === config.soloColorThemeId)
    ? config.soloColorThemeId
    : "";
  const settingsGroupId = config.soloSettingsGroupId
    && (config.settingsGroups ?? []).some((group) => group.id === config.soloSettingsGroupId)
    ? config.soloSettingsGroupId
    : "";
  return { themeId, settingsGroupId, active: Boolean(themeId || settingsGroupId) };
}

function applySolo(
  state: PhonoscopeThemeState,
  config: PhonoscopePreferences,
): PhonoscopeThemeState {
  const { themeId, settingsGroupId, active } = resolveSolo(config);
  if (!active) return state;
  return {
    ...state,
    themeId: themeId || state.themeId,
    settingsGroupIds: settingsGroupId ? [settingsGroupId] : state.settingsGroupIds,
    // Held, so clients that surface pause state show it as held rather than
    // as a rotation that has simply gone quiet.
    paused: true,
    // A lock is a cut, not a cross-fade: it is a "hold it here" switch used
    // while authoring, and a fade would misrepresent what is on screen.
    transitionSeconds: 0,
  };
}

/** Solo changes must bump the revision, or clients keep the ETag they hold. */
function trackSoloChanges(config: PhonoscopePreferences, now: number) {
  const themeId = config.soloColorThemeId ?? "";
  const settingsGroupId = config.soloSettingsGroupId ?? "";
  if (themeId === store.observedSoloThemeId
    && settingsGroupId === store.observedSoloSettingsGroupId) {
    return;
  }
  store.observedSoloThemeId = themeId;
  store.observedSoloSettingsGroupId = settingsGroupId;
  store.revision += 1;
  store.changedAtMs = now;
}

/**
 * Returns Nova's authoritative visualiser choice. Both Iridium and tvOS consume
 * this object; neither is allowed to maintain an independent rotation.
 */
export function readPhonoscopeThemeState(
  config: PhonoscopePreferences,
  now = Date.now(),
): PhonoscopeThemeState {
  trackSoloChanges(config, now);
  const nowPlaying = readPhonoscopeNowPlaying(now);
  const group = activePhonoscopeColorGroup(config, nowPlaying.track?.genreNames ?? []);
  if (!group?.entries.length) {
    if (store.groupId || store.entryId) {
      store.groupId = "";
      store.entryId = "";
      store.themeId = "";
      store.settingsGroupIds = [];
      store.entryIndex = 0;
      store.revision += 1;
      store.changedAtMs = now;
    }
    return applySolo(publicState(), config);
  }

  const previewEntry = config.editorPreviewColorEntryId &&
    group.entries.some((entry) => entry.id === config.editorPreviewColorEntryId)
    ? config.editorPreviewColorEntryId
    : "";
  const groupChanged = store.groupId !== group.id ||
    !group.entries.some((entry) => entry.id === store.entryId);
  const previewChanged = previewEntry !== store.observedPreviewEntryId;
  if (groupChanged || (previewEntry && previewChanged)) {
    store.groupId = group.id;
    const index = previewEntry
      ? Math.max(0, group.entries.findIndex((entry) => entry.id === previewEntry))
      : 0;
    store.paused = Boolean(previewEntry);
    store.previewActive = Boolean(previewEntry);
    select(group, index, now, previewEntry ? 0.05 : 0);
  } else if (!previewEntry && previewChanged && store.previewActive) {
    // Leaving the editor releases its transient pin. A remote command clears
    // previewActive first, so closing the editor cannot undo a user's explicit
    // pause/skip choice.
    store.previewActive = false;
    store.paused = false;
    store.changedAtMs = now;
    store.revision += 1;
  }
  store.observedPreviewEntryId = previewEntry;

  const currentTrackKey = nowPlaying.track ? trackKey(nowPlaying.track) : "";
  const currentBarIndex = nowPlaying.barIndex ?? null;
  const songChanged = Boolean(currentTrackKey && store.lastTrackKey
    && currentTrackKey !== store.lastTrackKey);
  const barChanged = nowPlaying.playing && currentBarIndex !== null
    && store.lastBarIndex !== null && currentBarIndex !== store.lastBarIndex;
  if (songChanged) store.songEventCount += 1;
  if (barChanged) store.barEventCount += 1;

  const rule = themeChangeRule(config, store.settingsGroupIds, group);
  let shouldAdvance = false;
  let transitionSeconds = store.transitionSeconds;
  // Soloing stops the rotation outright rather than letting it run underneath
  // an override: the theme-change effect must not fire while something is held.
  if (rule && !store.paused && !store.previewActive && !resolveSolo(config).active) {
    const { driver, binding } = rule;
    // The binding's release is the cross-fade: the slider is the transition's
    // progress against time, exactly as it is for every other effect.
    transitionSeconds = Math.max(0, binding.releaseSeconds ?? 0.6);
    if (driver.type === "timer") {
      const period = Math.max(0.25, driver.intervalSeconds) * Math.max(1, driver.every);
      shouldAdvance = now - store.changedAtMs >= (period + transitionSeconds) * 1_000;
    } else if (driver.type === "song") {
      shouldAdvance = songChanged
        && driverFiresOn(store.songEventCount, driver.every, driver.offset);
    } else if (driver.type === "downbeat" || driver.type === "beat") {
      // The now-playing uplink reports bars, not beats, so a beat driver
      // quantises to the downbeat here. A theme change on every beat is not a
      // look anyone asks for, and pretending otherwise would need a beat clock
      // the dashboard does not have.
      shouldAdvance = barChanged
        && driverFiresOn(store.barEventCount, driver.every, driver.offset);
    }
    // A level driver (bass, energy, …) carries no event, so it never advances
    // the rotation. Bind __themeChange to a pulse.
  }

  if (shouldAdvance && group.entries.length > 1) {
    const order = phonoscopePlaybackOrder(rule?.binding.params?.order);
    const index = chooseIndex(store.entryIndex, group.entries.length, 1, order);
    // Null is "play once, and it has finished": hold on the last entry rather
    // than wrapping. The clock still runs, so switching back to loop resumes.
    if (index !== null) select(group, index, now, transitionSeconds);
    else store.changedAtMs = now;
  } else if (shouldAdvance) {
    store.changedAtMs = now;
  }
  store.lastTrackKey = currentTrackKey;
  store.lastBarIndex = currentBarIndex;
  return applySolo(publicState(), config);
}

export function commandPhonoscopeTheme(
  config: PhonoscopePreferences,
  action: string,
  now = Date.now(),
): PhonoscopeThemeState {
  const current = readPhonoscopeThemeState(config, now);
  const nowPlaying = readPhonoscopeNowPlaying(now);
  const group = activePhonoscopeColorGroup(config, nowPlaying.track?.genreNames ?? []);
  if (!group?.entries.length) return current;

  if (action === "next" || action === "previous") {
    const rule = themeChangeRule(config, store.settingsGroupIds, group);
    // A manual skip always moves, so "play once" is read as loop here: the
    // transport must never dead-end with no way back to the first entry.
    const order = phonoscopePlaybackOrder(rule?.binding.params?.order);
    const direction: 1 | -1 = action === "next" ? 1 : -1;
    const index = chooseIndex(store.entryIndex, group.entries.length, direction,
      order === "once" ? "loop" : order);
    if (index !== null) {
      select(group, index, now, Math.max(0, rule?.binding.releaseSeconds ?? 0.6));
    }
    store.paused = true;
    store.previewActive = false;
  } else if (action === "pause") {
    if (!store.paused) store.revision += 1;
    store.paused = true;
    store.previewActive = false;
  } else if (action === "resume") {
    if (store.paused) store.revision += 1;
    store.paused = false;
    store.changedAtMs = now;
    store.previewActive = false;
  } else {
    throw new Error("Unknown theme action");
  }
  return applySolo(publicState(), config);
}

export function resetPhonoscopeThemeStateForTest() {
  Object.assign(store, emptyStore(), { changedAtMs: 0 });
}
