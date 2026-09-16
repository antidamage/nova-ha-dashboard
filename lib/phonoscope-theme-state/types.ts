import type { PhonoscopeDriver, PhonoscopeEffectBinding } from "../types";

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
  /** The centre slot's transition. */
  transition: PhonoscopeTransition;
  /**
   * The backdrop's, resolved from its own four axes at the same instant and by
   * the same rule. A separate object rather than a mode on the one above
   * because the two run concurrently and independently: the backdrop can
   * dissolve while the centrepiece slides.
   *
   * `transitionSeconds` stays the CENTRE's length, because that is the number
   * every existing consumer reads as the palette chase's time constant and the
   * palette changes with the centre.
   */
  backgroundTransition: PhonoscopeTransition;
};

// `themeId` is deliberately not carried: the store holds the entry's own theme
// and its alt separately, and the published id is resolved from the two.
export type ThemeStore = Omit<PhonoscopeThemeState, "themeId"> & {
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
  /**
   * The group a remote step landed on, or "" when nobody has stepped.
   *
   * Transient household state rather than a preference, exactly as `paused` is:
   * the transport's job is to override what the routing chose without editing
   * what the routing IS. It outranks genre routing — otherwise the arrows would
   * be inert on a genre-routed module, which is most of them — but loses to the
   * editor's preview pin, because authoring wins over transport.
   */
  groupOverrideId: string;
  /**
   * The config-side pick the override was taken against. When the module, the
   * genre-routing switch or the saved per-module group changes, that answer no
   * longer describes what the user last chose, so the override drops and the
   * config's own pick takes over again.
   */
  groupOverrideBasePick: string;
};


/**
 * The four axes one slot's transition is authored on.
 *
 * The centre and the background each have their own set with identical ranges
 * and meanings, so everything below resolves a set rather than naming the
 * centre's: the two slots change at the same moment but are not the same
 * picture, and dissolving the backdrop while the centrepiece slides has to be
 * authorable.
 */
export type TransitionAxes = {
  mode: string;
  axis: string;
  divisions: string;
  returnEdge: string;
};


export type PulseRule = { driver: PhonoscopeDriver; binding: PhonoscopeEffectBinding };

