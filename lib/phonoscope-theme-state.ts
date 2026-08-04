import type { PhonoscopePreferences } from "./types";
import { readPhonoscopeNowPlaying, trackKey } from "./phonoscope-now-playing";

export type PhonoscopeThemeState = {
  groupId: string;
  themeId: string;
  themeIndex: number;
  paused: boolean;
  revision: number;
  changedAtMs: number;
  transitionSeconds: number;
};

type ThemeStore = PhonoscopeThemeState & {
  lastTrackKey: string;
  lastBarIndex: number | null;
  observedPreviewThemeId: string;
  previewActive: boolean;
};

const globalWithThemeState = globalThis as typeof globalThis & {
  __novaPhonoscopeThemeState?: ThemeStore;
};

const store = globalWithThemeState.__novaPhonoscopeThemeState ??
  (globalWithThemeState.__novaPhonoscopeThemeState = {
    groupId: "",
    themeId: "",
    themeIndex: 0,
    paused: false,
    revision: 0,
    changedAtMs: Date.now(),
    transitionSeconds: 0,
    lastTrackKey: "",
    lastBarIndex: null,
    observedPreviewThemeId: "",
    previewActive: false,
  });

function activeGroup(config: PhonoscopePreferences) {
  const moduleId = config.activeModuleId ?? "";
  const previewId = config.editorPreviewColorGroupId?.trim();
  const groupId = previewId || config.moduleColorGroupIds?.[moduleId];
  return config.colorGroups?.find((group) => group.id === groupId && group.moduleId === moduleId);
}

function publicState(): PhonoscopeThemeState {
  const { groupId, themeId, themeIndex, paused, revision, changedAtMs, transitionSeconds } = store;
  return { groupId, themeId, themeIndex, paused, revision, changedAtMs, transitionSeconds };
}

function chooseIndex(current: number, count: number, direction: 1 | -1, shuffle: boolean) {
  if (!shuffle || count < 3) return (current + direction + count) % count;
  // Nova owns randomness too. Avoid selecting the current item so every skip
  // command has a visible result on every client.
  const offset = 1 + Math.floor(Math.random() * (count - 1));
  return (current + direction * offset + count * 2) % count;
}

function select(config: PhonoscopePreferences, index: number, now: number) {
  const group = activeGroup(config);
  if (!group?.themes.length) return;
  store.themeIndex = (index + group.themes.length) % group.themes.length;
  store.themeId = group.themes[store.themeIndex].id;
  store.changedAtMs = now;
  store.transitionSeconds = group.transitionSeconds;
  store.revision += 1;
}

/**
 * Returns Nova's authoritative visualiser theme choice. Both Iridium and tvOS
 * consume this object; neither is allowed to maintain an independent rotation.
 */
export function readPhonoscopeThemeState(
  config: PhonoscopePreferences,
  now = Date.now(),
): PhonoscopeThemeState {
  const group = activeGroup(config);
  if (!group?.themes.length) {
    if (store.groupId || store.themeId) {
      store.groupId = "";
      store.themeId = "";
      store.themeIndex = 0;
      store.revision += 1;
      store.changedAtMs = now;
    }
    return publicState();
  }

  const previewTheme = config.editorPreviewColorThemeId &&
    group.themes.some((theme) => theme.id === config.editorPreviewColorThemeId)
    ? config.editorPreviewColorThemeId
    : "";
  const groupChanged = store.groupId !== group.id ||
    !group.themes.some((theme) => theme.id === store.themeId);
  const previewChanged = previewTheme !== store.observedPreviewThemeId;
  if (groupChanged || (previewTheme && previewChanged)) {
    store.groupId = group.id;
    const selected = previewTheme || group.themes[0].id;
    store.themeIndex = Math.max(0, group.themes.findIndex((theme) => theme.id === selected));
    store.themeId = selected;
    store.paused = Boolean(previewTheme);
    store.previewActive = Boolean(previewTheme);
    store.changedAtMs = now;
    store.transitionSeconds = previewTheme ? 0.05 : group.transitionSeconds;
    store.revision += 1;
  } else if (!previewTheme && previewChanged && store.previewActive) {
    // Leaving the editor releases its transient pin. A remote command clears
    // previewActive first, so closing the editor cannot undo a user's explicit
    // pause/skip choice.
    store.previewActive = false;
    store.paused = false;
    store.changedAtMs = now;
    store.revision += 1;
  }
  store.observedPreviewThemeId = previewTheme;

  const nowPlaying = readPhonoscopeNowPlaying(now);
  const currentTrackKey = nowPlaying.track ? trackKey(nowPlaying.track) : "";
  const currentBarIndex = nowPlaying.barIndex ?? null;
  let shouldAdvance = false;
  if (!store.paused && !store.previewActive) {
    if (group.changeMode === "interval") {
      shouldAdvance = now - store.changedAtMs >= (group.waitSeconds + group.transitionSeconds) * 1_000;
    } else if (group.changeMode === "song") {
      shouldAdvance = Boolean(currentTrackKey && store.lastTrackKey && currentTrackKey !== store.lastTrackKey);
    } else if (group.changeMode === "downbeat") {
      shouldAdvance = nowPlaying.playing && currentBarIndex !== null &&
        store.lastBarIndex !== null && currentBarIndex !== store.lastBarIndex;
    }
  }

  if (shouldAdvance && group.themes.length > 1) {
    select(config, chooseIndex(store.themeIndex, group.themes.length, 1, group.order === "shuffle"), now);
  } else if (shouldAdvance) {
    store.changedAtMs = now;
  }
  store.lastTrackKey = currentTrackKey;
  store.lastBarIndex = currentBarIndex;
  return publicState();
}

export function commandPhonoscopeTheme(
  config: PhonoscopePreferences,
  action: string,
  now = Date.now(),
): PhonoscopeThemeState {
  const current = readPhonoscopeThemeState(config, now);
  const group = activeGroup(config);
  if (!group?.themes.length) return current;

  if (action === "next" || action === "previous") {
    const direction: 1 | -1 = action === "next" ? 1 : -1;
    select(config, chooseIndex(store.themeIndex, group.themes.length, direction, group.order === "shuffle"), now);
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
  return publicState();
}

export function resetPhonoscopeThemeStateForTest() {
  Object.assign(store, {
    groupId: "",
    themeId: "",
    themeIndex: 0,
    paused: false,
    revision: 0,
    changedAtMs: 0,
    transitionSeconds: 0,
    lastTrackKey: "",
    lastBarIndex: null,
    observedPreviewThemeId: "",
    previewActive: false,
  });
}
