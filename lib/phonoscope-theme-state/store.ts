// The theme-state package's only owner of globalThis state: the rotation's
// household-wide store. Every other file reads and mutates it through `store`.
import { cutTransition } from "./transition-model";
import type { ThemeStore } from "./types";

const globalWithThemeState = globalThis as typeof globalThis & {
  __novaPhonoscopeThemeState?: ThemeStore;
};


const emptyStore = (): ThemeStore => ({
  groupId: "",
  entryId: "",
  entryIndex: 0,
  altActive: false,
  settingsGroupIds: [],
  paused: false,
  revision: 0,
  changedAtMs: Date.now(),
  transitionSeconds: 0,
  transition: cutTransition(),
  backgroundTransition: cutTransition(),
  baseThemeId: "",
  entryAltThemeId: "",
  altChangedAtMs: Date.now(),
  lastTrackKey: "",
  lastBarIndex: null,
  songEventCount: 0,
  barEventCount: 0,
  observedPreviewEntryId: "",
  previewActive: false,
  observedSoloThemeId: "",
  observedSoloSettingsGroupId: "",
  groupOverrideId: "",
  groupOverrideBasePick: "",
});

export const store = globalWithThemeState.__novaPhonoscopeThemeState ??
  (globalWithThemeState.__novaPhonoscopeThemeState = emptyStore());


export function resetPhonoscopeThemeStateForTest() {
  Object.assign(store, emptyStore(), { changedAtMs: 0, altChangedAtMs: 0 });
}
