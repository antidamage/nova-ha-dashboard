import type {
  PhonoscopeColorGroup,
  PhonoscopeDriver,
  PhonoscopeEffectBinding,
  PhonoscopePreferences,
  PhonoscopeSettingsGroup,
} from "./types";
import { readPhonoscopeNowPlaying, trackKey } from "./phonoscope-now-playing";
import {
  driverFiresOn,
  mergePhonoscopeSettingsGroups,
  phonoscopePlaybackOrder,
  PHONOSCOPE_ALT_THEME_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
  type PhonoscopePlaybackOrder,
} from "./phonoscope-drivers";

/**
 * Everything a change carries about HOW it changes, latched when it fires.
 *
 * THE INITIATOR OWNS THE TRANSITION. These are resolved from the settings
 * groups that were in effect at the instant the pulse fired — the entry being
 * left, not the one being arrived at — and then held unchanged for the whole
 * run. Reading them live would mean the outgoing half of a change played by one
 * rule and the incoming half by another, because advancing the rotation also
 * swaps `settingsGroupIds`.
 */
export type PhonoscopeTransition = {
  /**
   * The ramp, read as a motion profile: attack eases in, hold is the flat
   * constant-velocity middle, release eases out. The change therefore lasts
   * exactly attack + hold + release. See `phonoscopeTransitionRamp`.
   */
  attackSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
  /** 0 cross-fade, 1 flip, 2 slide. Append-only. */
  mode: number;
  /** Degrees. 0 flips or slides horizontally, 90 vertically. */
  axisDegrees: number;
  /** Cuts across the axis, 0-10. Sections alternate travel direction. Slide only. */
  divisions: number;
  /** Slide only: a section returns from the edge it left by rather than the far one. */
  returnFromOrigin: boolean;
};

export type PhonoscopeThemeState = {
  groupId: string;
  /** The playlist entry that is live. Rotation indexes entries, not themes. */
  entryId: string;
  entryIndex: number;
  /**
   * The colour theme to show, carried alongside so clients can resolve a
   * palette. Already resolved through the alt state: while `altActive` is on
   * and the entry names an alt, this is the alt's id.
   */
  themeId: string;
  /**
   * The household's alt state. Global rather than per-entry: it survives
   * rotation and group changes, so an entry with no alt of its own shows its
   * own theme without turning the state off. Clients that index a palette by
   * entry rather than by id (the streamed renderer) need this to pick the alt
   * column; clients that resolve `themeId` directly can ignore it.
   */
  altActive: boolean;
  /** The entry's settings groups, in order. Merged by lanes-stack/scalars-layer. */
  settingsGroupIds: string[];
  paused: boolean;
  revision: number;
  changedAtMs: number;
  /**
   * How long the change takes, start to finish. Now the SUM of the ramp's three
   * phases rather than its release alone, so it still means exactly what every
   * existing consumer reads it as — the palette chase's time constant, 0 for a
   * cut — while the shape within it lives on `transition`.
   */
  transitionSeconds: number;
  transition: PhonoscopeTransition;
};

// `themeId` is deliberately not carried: the store holds the entry's own theme
// and its alt separately, and the published id is resolved from the two.
type ThemeStore = Omit<PhonoscopeThemeState, "themeId"> & {
  /** The selected entry's own theme, before the alt state is applied. */
  baseThemeId: string;
  /** The selected entry's alt, or "" when it has none. */
  entryAltThemeId: string;
  /** The alt pulse's own clock, so a timer on it cannot drag the rotation's. */
  altChangedAtMs: number;
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

/**
 * An instant change: no ramp at all, and therefore no mode worth naming.
 *
 * A solo lock, a first selection and an empty group are all cuts — "hold it
 * here" rather than "move to there" — and a flip or a slide with nowhere to
 * spend its time would just be a frame of missing image.
 */
function cutTransition(seconds = 0): PhonoscopeTransition {
  return {
    attackSeconds: 0,
    holdSeconds: 0,
    // A cut's whole duration is its ease-out, so `transitionSeconds` (the sum)
    // keeps carrying the number the palette chase has always read.
    releaseSeconds: Math.max(0, seconds),
    mode: 0,
    axisDegrees: 0,
    divisions: 0,
    returnFromOrigin: false,
  };
}

/**
 * The value an override-only axis resolves to across a set of settings groups.
 *
 * Last one wins, which is the whole of `override`: the entry lists its groups
 * in layering order, so an override group placed after the defaults replaces
 * what they set. Nothing sums, and a group that says nothing about the axis
 * leaves the earlier answer standing.
 *
 * The value is the binding's pinned range — `min` and `max` are the same number
 * on these axes — so no driver signal is involved. That is deliberate: the axis
 * is latched for the length of the transition, so a swept value would be
 * sampled exactly once and the sweep would be a lie.
 */
function overrideAxis(
  groups: PhonoscopeSettingsGroup[],
  effect: string,
  fallback: number,
): number {
  let resolved = fallback;
  for (const { lane } of mergePhonoscopeSettingsGroups(groups).lanes) {
    for (const binding of lane.bindings ?? []) {
      if (binding.effect !== effect) continue;
      const value = binding.min ?? binding.max;
      if (typeof value === "number" && Number.isFinite(value)) resolved = value;
    }
  }
  return resolved;
}

/**
 * The ramp the transition itself carries, if it carries one.
 *
 * The transition's control set always shows a ramp, because every transition
 * has one, and it is authored on the transition rather than on the pulse that
 * fires it — the pulse says "change now", the transition says how long the
 * change takes and how it accelerates. Resolved last-wins over the same
 * settings groups as the other axes, so an override group's ramp replaces the
 * defaults' along with the rest of its transition.
 *
 * Undefined when no settings group binds a transition at all, in which case the
 * pulse's own envelope is still the ramp — that is what it meant before the
 * transition modes existed, and a group authored back then keeps working.
 */
function overrideRamp(
  groups: PhonoscopeSettingsGroup[],
): [number, number, number] | undefined {
  let resolved: [number, number, number] | undefined;
  for (const { lane } of mergePhonoscopeSettingsGroups(groups).lanes) {
    for (const binding of lane.bindings ?? []) {
      if (binding.effect !== PHONOSCOPE_CENTRE_TRANSITION_EFFECT) continue;
      if (binding.attackSeconds === undefined && binding.holdSeconds === undefined
        && binding.releaseSeconds === undefined) continue;
      resolved = [
        Math.max(0, binding.attackSeconds ?? 0),
        Math.max(0, binding.holdSeconds ?? 0),
        Math.max(0, binding.releaseSeconds ?? 0),
      ];
    }
  }
  return resolved;
}

/**
 * The transition a firing pulse hands to the change it is about to make.
 *
 * Resolved from the settings groups in effect NOW — before the rotation moves
 * and swaps them — which is what makes the initiator, not the destination, the
 * owner of how the picture changes.
 */
function transitionFrom(
  config: PhonoscopePreferences,
  settingsGroupIds: string[],
  binding: PhonoscopeEffectBinding,
): PhonoscopeTransition {
  const byId = new Map((config.settingsGroups ?? []).map((group) => [group.id, group]));
  const groups = settingsGroupIds
    .map((id) => byId.get(id))
    .filter((group): group is PhonoscopeSettingsGroup => Boolean(group));
  const ramp = overrideRamp(groups);
  return {
    attackSeconds: ramp ? ramp[0] : Math.max(0, binding.attackSeconds ?? 0.05),
    holdSeconds: ramp ? ramp[1] : Math.max(0, binding.holdSeconds ?? 0),
    releaseSeconds: ramp ? ramp[2] : Math.max(0, binding.releaseSeconds ?? 0.6),
    mode: clampInteger(overrideAxis(groups, PHONOSCOPE_CENTRE_TRANSITION_EFFECT, 0), 0, 2),
    // Wrapped rather than clamped: 360 and 0 are the same direction, and an
    // authored 360 should not read as a different transition from an authored 0.
    axisDegrees: ((Math.round(
      overrideAxis(groups, PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT, 0),
    ) % 360) + 360) % 360,
    divisions: clampInteger(
      overrideAxis(groups, PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT, 0), 0, 10),
    returnFromOrigin:
      overrideAxis(groups, PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT, 0) >= 0.5,
  };
}

function clampInteger(value: number, low: number, high: number) {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, Math.round(value)));
}

/** The whole length of a transition: its ramp's three phases, end to end. */
function transitionLength(transition: PhonoscopeTransition) {
  return transition.attackSeconds + transition.holdSeconds + transition.releaseSeconds;
}

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

function publicState(): PhonoscopeThemeState {
  const {
    groupId, entryId, entryIndex, altActive, settingsGroupIds, paused, revision, changedAtMs,
    transitionSeconds, transition,
  } = store;
  return {
    groupId, entryId, entryIndex, themeId: resolvedThemeId(), altActive,
    settingsGroupIds: [...settingsGroupIds], paused, revision, changedAtMs, transitionSeconds,
    transition: { ...transition },
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

type PulseRule = { driver: PhonoscopeDriver; binding: PhonoscopeEffectBinding };

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

function themeChangeRule(
  config: PhonoscopePreferences,
  entrySettingsGroupIds: string[],
  group?: PhonoscopeColorGroup,
) {
  return pulseRule(config, entrySettingsGroupIds, PHONOSCOPE_THEME_CHANGE_EFFECT, group);
}

function select(
  group: PhonoscopeColorGroup,
  index: number,
  now: number,
  transition: PhonoscopeTransition,
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
    // A lock is a cut, not a transition: it is a "hold it here" switch used
    // while authoring, and a fade — or worse, a slide — would misrepresent what
    // is on screen.
    transitionSeconds: 0,
    transition: cutTransition(),
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
function applyAltPulse(
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
  store.transitionSeconds = transitionSeconds;
  // Bumped even when the showing entry has no alt: the household state really
  // did change, and the next entry that owns an alt must not be told to blend
  // from a revision the clients already hold.
  store.revision += 1;
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
  let transitionSeconds = store.transitionSeconds;
  // Soloing stops the rotation outright rather than letting it run underneath
  // an override: the theme-change effect must not fire while something is held.
  if (rule && !store.paused && !store.previewActive && !resolveSolo(config).active) {
    const { driver, binding } = rule;
    // Resolved from the settings groups showing RIGHT NOW, before the advance
    // below replaces them: the entry the change starts from owns it.
    transition = transitionFrom(config, store.settingsGroupIds, binding);
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
    if (index !== null) select(group, index, now, transition);
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
      select(group, index, now, rule
        ? transitionFrom(config, store.settingsGroupIds, rule.binding)
        : cutTransition());
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
  Object.assign(store, emptyStore(), { changedAtMs: 0, altChangedAtMs: 0 });
}
