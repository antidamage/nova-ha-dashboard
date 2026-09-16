import type { PhonoscopePreferences } from "../types";
import { readPhonoscopeNowPlaying, trackKey } from "../phonoscope-now-playing";
import { driverFiresOn, phonoscopePlaybackOrder } from "../phonoscope-drivers";
import {
  applyAltPulse,
  applySolo,
  resolveSolo,
  select,
  themeChangeRule,
  trackSoloChanges,
} from "./rotation";
import {
  activePhonoscopeColorGroup,
  chooseIndex,
  configGroupPick,
  moduleColorGroups,
  publicState,
} from "./selection";
import { store } from "./store";
import {
  BACKGROUND_TRANSITION_AXES,
  cutTransition,
  transitionFrom,
  transitionLength,
} from "./transition-model";
import type { PhonoscopeThemeState } from "./types";

/**
 * Returns Nova's authoritative visualiser choice. Both voice host and tvOS consume
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
      store.baseThemeId = "";
      store.entryAltThemeId = "";
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
    // Landing on a group, and stepping through it in the editor, are both cuts:
    // there is no outgoing picture the change came from, only a destination.
    select(group, index, now, cutTransition(previewEntry ? 0.05 : 0));
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
  let transition = store.transition;
  let backgroundTransition = store.backgroundTransition;
  let transitionSeconds = store.transitionSeconds;
  // Soloing stops the rotation outright rather than letting it run underneath
  // an override: the theme-change effect must not fire while something is held.
  if (rule && !store.paused && !store.previewActive && !resolveSolo(config).active) {
    const { driver, binding } = rule;
    // Resolved from the settings groups showing RIGHT NOW, before the advance
    // below replaces them: the entry the change starts from owns it.
    transition = transitionFrom(config, store.settingsGroupIds, binding);
    backgroundTransition = transitionFrom(
      config, store.settingsGroupIds, binding, BACKGROUND_TRANSITION_AXES);
    transitionSeconds = transitionLength(transition);
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
    if (index !== null) select(group, index, now, transition, backgroundTransition);
    else store.changedAtMs = now;
  } else if (shouldAdvance) {
    store.changedAtMs = now;
  }

  // The alt pulse is evaluated after the rotation so that when both fire on the
  // same event the flip lands on the entry that is now showing, rather than
  // flipping the outgoing one a frame before it leaves.
  applyAltPulse(config, group, now, {
    songChanged,
    barChanged,
    held: store.paused || store.previewActive || resolveSolo(config).active,
  });

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
      // A manual skip is still a change of entry, so it plays the transition the
      // entry being left would have played. Without a rule anywhere on the
      // playlist there is nothing authored to read, so it cuts.
      select(group, index, now,
        rule ? transitionFrom(config, store.settingsGroupIds, rule.binding) : cutTransition(),
        rule
          ? transitionFrom(config, store.settingsGroupIds, rule.binding,
            BACKGROUND_TRANSITION_AXES)
          : cutTransition());
    }
    store.paused = true;
    store.previewActive = false;
  } else if (action === "next-group" || action === "previous-group") {
    // Stepping GROUPS, not entries: the arrows move sideways across the
    // playlists rather than along the one that is playing. The rotation is
    // deliberately left running — the sequence inside a group is the group, and
    // freezing it on arrival would make every group look like one theme.
    // Pausing stays the pause button's job.
    const groups = moduleColorGroups(config).filter((entry) => entry.entries.length);
    const direction = action === "next-group" ? 1 : -1;
    const current = groups.findIndex((entry) => entry.id === group.id);
    if (groups.length > 1) {
      const target = groups[(Math.max(0, current) + direction + groups.length) % groups.length];
      const rule = themeChangeRule(config, store.settingsGroupIds, group);
      store.groupOverrideId = target.id;
      store.groupOverrideBasePick = configGroupPick(config);
      store.groupId = target.id;
      // A group step is still a change of picture, so it plays the transition
      // the entry being left would have played — resolved before `select`
      // swaps the settings groups out, exactly as a skip does.
      select(target, 0, now,
        rule ? transitionFrom(config, store.settingsGroupIds, rule.binding) : cutTransition(),
        rule
          ? transitionFrom(config, store.settingsGroupIds, rule.binding,
            BACKGROUND_TRANSITION_AXES)
          : cutTransition());
      store.previewActive = false;
    }
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

