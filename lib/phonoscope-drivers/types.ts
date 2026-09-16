// Driver-lane evaluator shapes. Types only.

/**
 * How an image is sized against the frame. APPEND-ONLY: stored bindings hold
 * these numbers.
 *
 * `manual` is the width and height the sliders state. `fit` is the largest the
 * image goes without any of it leaving the frame, `fill` the smallest that
 * leaves none of the frame uncovered — both derived from the image's own
 * proportions, which is why neither offers a width or a height to author. The
 * scale multiplies whatever the mode arrived at, in every mode.
 */
export type PhonoscopeImageFit = "manual" | "fit" | "fill";

/** The centre-image transition modes. APPEND-ONLY: stored bindings hold these numbers. */
export type PhonoscopeCentreTransition = "crossfade" | "flip" | "slide";

/**
 * How the playlist plays: loop, shuffle, or once through and stop.
 *
 * Stored as a number on the `__themeChange` binding's `params.order`, and
 * APPEND-ONLY — 0 and 1 keep the meanings every saved configuration already
 * holds, so adding "once" as 2 cannot silently repoint an existing playlist.
 */
export type PhonoscopePlaybackOrder = "loop" | "shuffle" | "once";

export type PhonoscopeEffectDeclaration = {
  id: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

/** One tick of music state, as both engines already compute it. */
export type PhonoscopeSignalFrame = {
  /** Monotonic simulation seconds. */
  time: number;
  /** Seconds since the previous evaluation. */
  delta: number;
  beatIndex: number;
  barIndex: number;
  /** 0..1 position within the current beat, for subdividing it. */
  beatPhase: number;
  /** 0..1 position within the current bar, for subdividing it. */
  barPhase: number;
  /** 0..1, decaying across the beat. */
  beatPulse: number;
  /** 0..1, `beatPulse` on the first beat of a bar and zero otherwise. */
  downbeatPulse: number;
  /** 0..1 aggregate loudness. */
  energy: number;
  /** 32 bands, 0..1. */
  spectrum: number[];
  /** Beats per bar, for converting a downbeat period into beats. */
  beatsPerBar: number;
  /** Seconds per beat, for comparing beat-family and timer periods. */
  secondsPerBeat: number;
  /** Changes when the playing track changes. */
  trackSeed: number;
};

/**
 * Per driver-slot runtime state. A slot is one driver of one binding, so the
 * primary driver and each modifier keep independent envelope phases and a
 * retrigger on one never disturbs another.
 */
export type PhonoscopeDriverState = {
  /** Pulse envelope output, 0..1. */
  level: number;
  phase: "idle" | "attack" | "hold" | "release";
  holdRemaining: number;
  /** The last event this slot fired on; a change is a retrigger. */
  eventKey: string;
  /** Follower drivers glide `current` toward `target`. */
  current: number;
  target: number;
  /** `song` has no natural index, so the slot counts track changes itself. */
  eventCount: number;
  lastTrackSeed: number;
  seenTrack: boolean;
  /**
   * `random` timing: the window `target` was rolled for, and whether that
   * window's one fire has already happened. `target` carries the rolled
   * threshold — the fraction through the window at which it fires.
   */
  windowKey: string;
  fired: boolean;
  /**
   * `randomValue` slots only: whether a value has ever been drawn. Without it a
   * lane whose driver never writes an event key — every continuous driver — would
   * sit on the zero `target` forever and hold the effect at its floor.
   */
  seeded: boolean;
};

export type PhonoscopeDriverStates = Map<string, PhonoscopeDriverState>;


export type EnvelopeTimes = {
  attackSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
};

