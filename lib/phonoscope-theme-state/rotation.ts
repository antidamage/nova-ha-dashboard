import type { PhonoscopeColorGroup, PhonoscopePreferences, PhonoscopeSettingsGroup } from "../types";
import {
  driverFiresOn,
  mergePhonoscopeSettingsGroups,
  PHONOSCOPE_ALT_THEME_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
} from "../phonoscope-drivers";
import { store } from "./store";
import {
  BACKGROUND_TRANSITION_AXES,
  cutTransition,
  transitionFrom,
  transitionLength,
} from "./transition-model";
import type { PhonoscopeThemeState, PhonoscopeTransition, PulseRule } from "./types";

function pulseRuleFor(
  config: PhonoscopePreferences,
  settingsGroupIds: string[],
  effect: string,
): PulseRule | null {
  const byId = new Map((config.settingsGroups ?? []).map((group) => [group.id, group]));
  const groups = settingsGroupIds
    .map((id) => byId.get(id))
    .filter((group): group is PhonoscopeSettingsGroup => Boolean(group));
  const merged = mergePhonoscopeSettingsGroups(groups);
  for (const { lane } of merged.lanes) {
    const binding = lane.bindings.find((entry) => entry.effect === effect);
    if (binding) return { driver: lane.driver, binding };
  }
  return null;
}

/**
 * The rotation-pulse binding that governs `effect` right now.
 *
 * Preferably the one the *current* entry names, so different entries can hold
 * for different lengths. Failing that, the first one anywhere on the playlist.
 *
 * That fallback is what makes the rotation a loop. Reading the current entry
 * alone meant a playlist where only some entries bound `__themeChange` advanced
 * onto an entry that bound nothing and then pinned there forever — the rotation
 * ran once and stopped, which is not what a sequential playlist means. An entry
 * with no binding of its own now inherits the playlist's, so it holds for that
 * long and moves on. `__altTheme` inherits by the same rule, for the same
 * reason: the alt state is the playlist's, not one entry's.
 */
function pulseRule(
  config: PhonoscopePreferences,
  entrySettingsGroupIds: string[],
  effect: string,
  group?: PhonoscopeColorGroup,
): PulseRule | null {
  const own = pulseRuleFor(config, entrySettingsGroupIds, effect);
  if (own || !group) return own;
  for (const entry of group.entries) {
    const inherited = pulseRuleFor(config, entry.settingsGroupIds, effect);
    if (inherited) return inherited;
  }
  return null;
}

export function themeChangeRule(
  config: PhonoscopePreferences,
  entrySettingsGroupIds: string[],
  group?: PhonoscopeColorGroup,
) {
  return pulseRule(config, entrySettingsGroupIds, PHONOSCOPE_THEME_CHANGE_EFFECT, group);
}

export function select(
  group: PhonoscopeColorGroup,
  index: number,
  now: number,
  transition: PhonoscopeTransition,
  // Defaulted to the centre's so a cut is stated once: every caller that hands
  // a `cutTransition()` here means both slots cut, and none of them has to say
  // it twice.
  backgroundTransition: PhonoscopeTransition = transition,
) {
  if (!group.entries.length) return;
  store.entryIndex = (index + group.entries.length) % group.entries.length;
  const entry = group.entries[store.entryIndex];
  store.entryId = entry.id;
  store.baseThemeId = entry.themeId;
  store.entryAltThemeId = entry.altThemeId ?? "";
  // The transition was resolved from the OUTGOING entry's settings groups, so
  // it must be latched before this line replaces them.
  store.settingsGroupIds = [...entry.settingsGroupIds];
  store.changedAtMs = now;
  store.transition = transition;
  store.backgroundTransition = backgroundTransition;
  // The centre's length, deliberately: this is the palette chase's time
  // constant and the palette changes with the centre. A longer backdrop
  // transition runs past it and is timed off `changedAtMs` by the engines.
  store.transitionSeconds = transitionLength(transition);
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
export function resolveSolo(config: PhonoscopePreferences) {
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

export function applySolo(
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
    // A lock is a cut, not a transition: it is a "hold it here" switch used
    // while authoring, and a fade — or worse, a slide — would misrepresent what
    // is on screen.
    transitionSeconds: 0,
    transition: cutTransition(),
    backgroundTransition: cutTransition(),
  };
}

/** Solo changes must bump the revision, or clients keep the ETag they hold. */
export function trackSoloChanges(config: PhonoscopePreferences, now: number) {
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
 * `__altTheme`: each firing flips the household's alt state.
 *
 * Deliberately a flip of one global boolean rather than a per-entry mode. The
 * user's picture is "we are in alt now", and it has to survive the rotation
 * moving on — going A → A-alt → B (no alt, so B) → C shows C's alt, because the
 * state was never turned off, only unusable in the middle.
 *
 * Held exactly as the rotation is held: a pause, an editor preview or a solo is
 * "hold this picture", and a flip is a picture change like any other.
 */
export function applyAltPulse(
  config: PhonoscopePreferences,
  group: PhonoscopeColorGroup,
  now: number,
  context: { songChanged: boolean; barChanged: boolean; held: boolean },
) {
  const rule = pulseRule(config, store.settingsGroupIds, PHONOSCOPE_ALT_THEME_EFFECT, group);
  if (!rule) return;
  const { driver, binding } = rule;
  // Read exactly the way `__themeChange` reads it, and from the same place: the
  // settings groups showing now. An alt flip does not move the rotation, so
  // there is no incoming entry to confuse this with — but the two pulses have to
  // agree on what a transition is or the same picture would change two ways.
  const transition = transitionFrom(config, store.settingsGroupIds, binding);
  const backgroundTransition = transitionFrom(
    config, store.settingsGroupIds, binding, BACKGROUND_TRANSITION_AXES);
  const transitionSeconds = transitionLength(transition);
  if (context.held) {
    // Keep the clock under the hold, or releasing a long pause fires the flip
    // immediately on a timer that was never really running.
    store.altChangedAtMs = now;
    return;
  }

  let fired = false;
  if (driver.type === "timer") {
    const period = Math.max(0.25, driver.intervalSeconds) * Math.max(1, driver.every);
    fired = now - store.altChangedAtMs >= (period + transitionSeconds) * 1_000;
  } else if (driver.type === "song") {
    fired = context.songChanged && driverFiresOn(store.songEventCount, driver.every, driver.offset);
  } else if (driver.type === "downbeat" || driver.type === "beat") {
    // Quantised to the downbeat for the same reason the rotation is: the
    // now-playing uplink reports bars, and there is no beat clock here.
    fired = context.barChanged && driverFiresOn(store.barEventCount, driver.every, driver.offset);
  }
  // A level driver carries no event, so it can never flip the state.
  if (!fired) return;

  store.altActive = !store.altActive;
  store.altChangedAtMs = now;
  store.transition = transition;
  store.backgroundTransition = backgroundTransition;
  store.transitionSeconds = transitionSeconds;
  // Bumped even when the showing entry has no alt: the household state really
  // did change, and the next entry that owns an alt must not be told to blend
  // from a revision the clients already hold.
  store.revision += 1;
}

