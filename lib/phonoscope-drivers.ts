import type {
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeSettingsGroup,
} from "./types";

/**
 * The Phonoscope driver-lane evaluator.
 *
 * This file is the reference implementation of the semantics described in
 * PHONOSCOPE_MODULE_SPEC.md under "Driver lanes". Two other engines implement
 * the same rules and must agree with it exactly:
 *
 * - `nova-visualiser/src/core/parameter_drivers.{h,cpp}` (C++, the renderer)
 * - `NovaAppleTVDashboard/PhonoscopeStore.swift` (Swift, the tvOS fallback)
 *
 * The dashboard needs its own copy because two effects never reach either
 * engine: `__hueOffset` drives House Party lighting from `lib/ha.ts`, and
 * `__themeChange` advances the rotation in `lib/phonoscope-theme-state.ts`.
 * Changing anything here means changing all three and re-recording
 * `nova-visualiser/tests/conformance/parameter-drivers`.
 */

/** Private picture-level effects: household configuration, declared by no module. */
export const PHONOSCOPE_GLOW_BLUR_EFFECT = "__glowBlur";
export const PHONOSCOPE_GLOW_OPACITY_EFFECT = "__glowOpacity";
export const PHONOSCOPE_GLOW_OVERDRIVE_EFFECT = "__glowOverdrive";
export const PHONOSCOPE_GLOW_CLAMP_EFFECT = "__glowClamp";
export const PHONOSCOPE_GLOW_BLEND_EFFECT = "__glowBlend";
export const PHONOSCOPE_MESSAGE_SCALE_EFFECT = "__messageScale";
/**
 * The centre slot's size, as percentages of the frame.
 *
 * Width is the AUTHORED axis and height follows from it under `__centreProportional`
 * — the same rule the background image obeys, so one mental model covers both
 * slots. `__centreHeight` predates the width axis (it was the authored one when
 * the centre could only ever keep its source's proportions) and is kept as the
 * free height for the un-proportional case; `phonoscope-migrate-v6.ts` converts
 * the old value into the width that draws the same picture.
 */
export const PHONOSCOPE_CENTRE_HEIGHT_EFFECT = "__centreHeight";
export const PHONOSCOPE_CENTRE_WIDTH_EFFECT = "__centreWidth";
/** Manual / fit to screen / fill screen. APPEND-ONLY; see `ImageFit`. */
export const PHONOSCOPE_CENTRE_FIT_EFFECT = "__centreFit";
/** 0/1: height follows the width and the image's native proportions. */
export const PHONOSCOPE_CENTRE_PROPORTIONAL_EFFECT = "__centreProportional";
export const PHONOSCOPE_HUE_OFFSET_EFFECT = "__hueOffset";
export const PHONOSCOPE_THEME_CHANGE_EFFECT = "__themeChange";
/**
 * Toggles the household's alt-theme state. Each firing flips it, so the picture
 * blends to the current entry's alt theme and the next firing blends back.
 */
export const PHONOSCOPE_ALT_THEME_EFFECT = "__altTheme";
/**
 * Frame geometry and the vignette framing it.
 *
 * Agnostic about what the backdrop actually is: when the colour theme names a
 * `backgroundImageId` these size that image, and when it does not they size the
 * procedural band exactly as they always have. That is the whole point of
 * sizing the backdrop rather than sizing a picture — the controls do not change
 * when the content does.
 */
export const PHONOSCOPE_BG_HEIGHT_EFFECT = "__bgHeight";
export const PHONOSCOPE_BG_WIDTH_EFFECT = "__bgWidth";
/**
 * A multiplier on top of the width and height, and the one axis here worth
 * binding to a driver lane: it is what makes the backdrop thump on the beat.
 * Applies in every fit mode, so a fitted or filled image can still be swept.
 */
export const PHONOSCOPE_BG_SCALE_EFFECT = "__bgScale";
/** Manual / fit to screen / fill screen. APPEND-ONLY; see `ImageFit`. */
export const PHONOSCOPE_BG_FIT_EFFECT = "__bgFit";
/** 0/1: height follows the width and the image's native proportions. */
export const PHONOSCOPE_BG_PROPORTIONAL_EFFECT = "__bgProportional";
export const PHONOSCOPE_VIGNETTE_OPACITY_EFFECT = "__vignetteOpacity";
export const PHONOSCOPE_VIGNETTE_SIZE_EFFECT = "__vignetteSize";
/** How the scene layer meets the backdrop. */
export const PHONOSCOPE_SCENE_BLEND_EFFECT = "__sceneBlend";
/**
 * How the centre image changes when the rotation moves to an entry naming a
 * different one: cross-fade, flip, or slide, plus the three parameters the
 * latter two read. See `centre_image_transition.h` for the geometry.
 */
export const PHONOSCOPE_CENTRE_TRANSITION_EFFECT = "__centreTransition";
export const PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT = "__centreTransitionAxis";
export const PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT = "__centreTransitionDivisions";
export const PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT = "__centreTransitionReturn";
/**
 * The same four axes for the background image. Separate from the centre's on
 * purpose: the two slots change at the same moment but are not the same
 * picture, and dissolving the backdrop while the centrepiece slides is a
 * combination worth being able to author.
 */
export const PHONOSCOPE_BG_TRANSITION_EFFECT = "__bgTransition";
export const PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT = "__bgTransitionAxis";
export const PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT = "__bgTransitionDivisions";
export const PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT = "__bgTransitionReturn";

/**
 * Effects that always combine by `override`, whatever a settings group stored.
 *
 * A transition is one indivisible instruction: half a flip summed with half a
 * slide is not a transition, it is a fault. So these axes never stack — the
 * last group in the entry's list replaces the value outright, which is exactly
 * what "an override group beats the defaults" has to mean. The "When stacked"
 * control is not offered for them.
 */
export const PHONOSCOPE_OVERRIDE_ONLY_EFFECTS: ReadonlySet<string> = new Set([
  PHONOSCOPE_CENTRE_TRANSITION_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_CENTRE_TRANSITION_RETURN_EFFECT,
  PHONOSCOPE_BG_TRANSITION_EFFECT,
  PHONOSCOPE_BG_TRANSITION_AXIS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_DIVISIONS_EFFECT,
  PHONOSCOPE_BG_TRANSITION_RETURN_EFFECT,
]);

export function isPhonoscopeOverrideOnlyEffect(effect: string) {
  return PHONOSCOPE_OVERRIDE_ONLY_EFFECTS.has(effect);
}

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

export const PHONOSCOPE_IMAGE_FIT_VALUES: Record<PhonoscopeImageFit, number> = {
  manual: 0,
  fit: 1,
  fill: 2,
};

export function phonoscopeImageFit(value: number | undefined): PhonoscopeImageFit {
  if ((value ?? 0) >= 1.5) return "fill";
  if ((value ?? 0) >= 0.5) return "fit";
  return "manual";
}

/** The centre-image transition modes. APPEND-ONLY: stored bindings hold these numbers. */
export type PhonoscopeCentreTransition = "crossfade" | "flip" | "slide";

export const PHONOSCOPE_CENTRE_TRANSITION_VALUES: Record<PhonoscopeCentreTransition, number> = {
  crossfade: 0,
  flip: 1,
  slide: 2,
};

export function phonoscopeCentreTransition(value: number | undefined): PhonoscopeCentreTransition {
  if ((value ?? 0) >= 1.5) return "slide";
  if ((value ?? 0) >= 0.5) return "flip";
  return "crossfade";
}

/**
 * The two rotation pulses: a firing is an instruction, not a magnitude.
 *
 * Both are fixed at the declared 0-1 range — any non-zero contribution is one
 * firing — and both read their binding's release as the cross-fade the picture
 * takes to reach the new palette, which is why neither offers a range and both
 * label their envelope "Transition".
 */
export function isPhonoscopeThemePulseEffect(effect: string) {
  return effect === PHONOSCOPE_THEME_CHANGE_EFFECT || effect === PHONOSCOPE_ALT_THEME_EFFECT;
}

/**
 * How the playlist plays: loop, shuffle, or once through and stop.
 *
 * Stored as a number on the `__themeChange` binding's `params.order`, and
 * APPEND-ONLY — 0 and 1 keep the meanings every saved configuration already
 * holds, so adding "once" as 2 cannot silently repoint an existing playlist.
 */
export type PhonoscopePlaybackOrder = "loop" | "shuffle" | "once";

export function phonoscopePlaybackOrder(value: number | undefined): PhonoscopePlaybackOrder {
  if ((value ?? 0) >= 1.5) return "once";
  if ((value ?? 0) >= 0.5) return "shuffle";
  return "loop";
}

export const PHONOSCOPE_PLAYBACK_ORDER_VALUES: Record<PhonoscopePlaybackOrder, number> = {
  loop: 0,
  shuffle: 1,
  once: 2,
};

/**
 * A combined value may exceed the effect's declared maximum — stacking lanes is
 * meant to be able to overshoot. This is only the guard that keeps the
 * simulation finite: at most four full ranges above the resting value.
 */
export const PHONOSCOPE_OVERSHOOT_RANGES = 4;

/** The most a lane's summed driver signal can reach before it is clamped. */
export const PHONOSCOPE_MAX_LANE_SIGNAL = 4;

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

export function createPhonoscopeDriverStates(): PhonoscopeDriverStates {
  return new Map();
}

/**
 * FNV-1a over the UTF-8 bytes, mirroring `nova::stableSeed` in
 * `nova-visualiser/src/core/signal.cpp`.
 *
 * Note the offset basis is 1469598103934665603, which is *not* the canonical
 * FNV-1a 64-bit basis (14695981039346656037). It is what both engines already
 * ship, and the conformance corpus is recorded against it, so it is reproduced
 * here deliberately rather than corrected. A language-provided string hash must
 * never be substituted — Swift salts those per process.
 */
const FNV_OFFSET_BASIS = 1469598103934665603n;
const FNV_PRIME = 1099511628211n;
const U64_MASK = (1n << 64n) - 1n;

export function stablePhonoscopeSeed(value: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(value)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & U64_MASK;
  }
  return hash;
}

/** The 0..1 fraction a seed resolves to, matching engine.cpp's `seed % 1000003`. */
export function seedFraction(seed: bigint): number {
  return Number(seed % 1000003n) / 1000002;
}

const PULSE_TYPES = new Set(["beat", "downbeat", "timer", "song"]);

/** One of the four literal pulse types — not `random`, which borrows one. */
export function isPulseDriver(driver: PhonoscopeDriver) {
  return PULSE_TYPES.has(driver.type);
}

/**
 * Whether this driver fires discrete events at all, as opposed to carrying a
 * continuous level.
 *
 * This is the question almost everything outside the evaluator actually wants:
 * `random` is a pulse whose timing is jittered, so it advances the rotation and
 * re-draws a `randomValue` exactly like the four named pulses do. Only
 * `isPulseDriver`'s two callers — the signal dispatch and the cadence copy —
 * care about the narrower distinction.
 */
export function driverFiresEvents(driver: PhonoscopeDriver) {
  return isPulseDriver(driver) || driver.type === "random";
}

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Whether event `index` is one the driver fires on. `every` is the cycle length
 * and `offset` picks which event within it, so "every 4th downbeat, from the
 * 2nd" is `every: 4, offset: 1`.
 */
export function driverFiresOn(index: number, every: number, offset: number) {
  const cycle = Math.max(1, Math.floor(finite(every, 1)));
  if (cycle === 1) return true;
  const phase = Math.max(0, Math.min(cycle - 1, Math.floor(finite(offset, 0))));
  return (((index - phase) % cycle) + cycle) % cycle === 0;
}

/** The subdivisions a counted pulse can be split into. */
export const PHONOSCOPE_DIVIDE_CHOICES = [1, 2, 4, 8];

/**
 * How many times per pulse this driver fires. Anything other than a supported
 * subdivision reads as the whole pulse, so an older configuration — or a newer
 * one this engine does not understand — degrades to the behaviour it had before
 * subdivisions existed rather than to silence.
 */
export function driverDivide(driver: PhonoscopeDriver) {
  const value = Math.floor(finite(driver.divide ?? 1, 1));
  return PHONOSCOPE_DIVIDE_CHOICES.includes(value) ? value : 1;
}

/**
 * The event index a subdivided pulse is on: the whole-pulse index plus how far
 * through it the frame is, scaled by the subdivision. At `divide: 1` this is
 * exactly the whole-pulse index, so an undivided driver is untouched.
 */
function subdividedIndex(index: number, phase: number, divide: number) {
  if (divide <= 1) return Math.floor(finite(index, 0));
  const position = Math.floor(finite(index, 0)) + Math.max(0, Math.min(1, finite(phase, 0)));
  return Math.floor(position * divide);
}

/**
 * The pulse a `random` driver's window is measured in. An unrecognised cadence
 * reads as `beat`, so a configuration from a newer dashboard degrades to the
 * commonest window rather than to silence.
 */
function randomCadenceDriver(driver: PhonoscopeDriver): PhonoscopeDriver {
  return {
    ...driver,
    type: PULSE_TYPES.has(driver.cadence) ? driver.cadence : "beat",
  };
}

/**
 * Where the frame sits inside the driver's firing window, as a whole window
 * index and a 0..1 fraction through it.
 *
 * The window is the whole span between one firing opportunity and the next —
 * `every` windows of the pulse, or one `divide`th of it — which is exactly the
 * span `driverPeriodSeconds` measures. That is what makes "every 4th downbeat"
 * mean one fire somewhere in four bars rather than a fire inside the fourth.
 *
 * `song` has no position: a track's length is not known until it ends, so there
 * is no "fraction through" it to place anything at. Returns null there, and the
 * caller falls back to firing on the track change itself.
 */
function driverWindowPosition(
  driver: PhonoscopeDriver,
  frame: PhonoscopeSignalFrame,
): { index: number; fraction: number } | null {
  if (driver.type === "song") return null;
  let position: number;
  if (driver.type === "timer") {
    position = finite(frame.time, 0) / Math.max(0.25, finite(driver.intervalSeconds, 4));
  } else {
    const whole = driver.type === "downbeat" ? frame.barIndex : frame.beatIndex;
    const phase = driver.type === "downbeat" ? frame.barPhase : frame.beatPhase;
    // Same continuous position `subdividedIndex` floors, kept unfloored: the
    // fractional part is the whole point here.
    position = (Math.floor(finite(whole, 0)) + Math.max(0, Math.min(1, finite(phase, 0))))
      * driverDivide(driver);
  }
  // `every` and `divide` are the two directions of one control and never both
  // apply, so this scales by whichever is in play.
  const every = Math.max(1, Math.floor(finite(driver.every, 1)));
  const offset = Math.max(0, Math.min(every - 1, Math.floor(finite(driver.offset, 0))));
  const cycles = (position - offset) / every;
  const index = Math.floor(cycles);
  return { index, fraction: cycles - index };
}

/**
 * How rarely a lane fires, in seconds, used to rank lanes when an effect
 * combines by `strongest` or `common`. Longer wins under `strongest`, so an
 * every-4th-downbeat hit covers a plain downbeat, which covers a beat.
 * Continuous drivers have no period at all and never win outright either way.
 */
export function driverPeriodSeconds(driver: PhonoscopeDriver, frame: PhonoscopeSignalFrame): number {
  // A random driver fires exactly once per window, so its rarity IS its
  // window — the same period the cadence pulse would have had.
  if (driver.type === "random") return driverPeriodSeconds(randomCadenceDriver(driver), frame);
  const every = Math.max(1, Math.floor(finite(driver.every, 1)));
  const secondsPerBeat = Math.max(1e-6, finite(frame.secondsPerBeat, 0.5));
  const beatsPerBar = Math.max(1, finite(frame.beatsPerBar, 4));
  // Subdividing makes a lane commoner, which is exactly what `strongest` ranks
  // by, so a quarter-beat lane loses to a plain beat the same way a beat loses
  // to a downbeat.
  const divide = driverDivide(driver);
  switch (driver.type) {
    // A song is the rarest thing that can happen, and its length is unknown
    // ahead of time, so it always outranks a counted pulse.
    case "song": return Number.POSITIVE_INFINITY;
    case "timer": return every * Math.max(0.25, finite(driver.intervalSeconds, 4));
    case "downbeat": return every * beatsPerBar * secondsPerBeat / divide;
    case "beat": return every * secondsPerBeat / divide;
    default: return 0;
  }
}

/** The raw 0..1 level a continuous driver carries this tick. */
function levelSignal(driver: PhonoscopeDriver, frame: PhonoscopeSignalFrame) {
  if (driver.type === "energy") return clamp01(finite(frame.energy, 0));
  const spectrum = frame.spectrum ?? [];
  let first = 0;
  let last = spectrum.length;
  if (driver.type === "bass") last = Math.min(last, 8);
  else if (driver.type === "mid") { first = Math.min(8, last); last = Math.min(last, 20); }
  else if (driver.type === "treble") first = Math.min(20, last);
  let peak = 0;
  for (let index = first; index < last; index += 1) {
    peak = Math.max(peak, finite(spectrum[index], 0));
  }
  return clamp01(peak);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function emptyState(): PhonoscopeDriverState {
  return {
    level: 0,
    phase: "idle",
    holdRemaining: 0,
    eventKey: "",
    current: 0,
    target: 0,
    eventCount: 0,
    lastTrackSeed: 0,
    seenTrack: false,
    windowKey: "",
    fired: false,
    seeded: false,
  };
}

function stateFor(states: PhonoscopeDriverStates, key: string) {
  let state = states.get(key);
  if (!state) {
    state = emptyState();
    states.set(key, state);
  }
  return state;
}

/**
 * The event key a pulse driver is currently on, or an empty string when this
 * tick is not one it fires on. `song` counts its own events because a track
 * seed is an identity, not an ordinal.
 */
function pulseEventKey(
  driver: PhonoscopeDriver,
  frame: PhonoscopeSignalFrame,
  state: PhonoscopeDriverState,
) {
  if (driver.type === "song") {
    const seed = finite(frame.trackSeed, 0);
    if (!state.seenTrack) {
      state.seenTrack = true;
      state.lastTrackSeed = seed;
    } else if (seed !== state.lastTrackSeed) {
      state.lastTrackSeed = seed;
      state.eventCount += 1;
    }
    return driverFiresOn(state.eventCount, driver.every, driver.offset)
      ? `s:${state.eventCount}`
      : "";
  }
  if (driver.type === "timer") {
    const interval = Math.max(0.25, finite(driver.intervalSeconds, 4));
    const index = Math.floor(finite(frame.time, 0) / interval);
    return driverFiresOn(index, driver.every, driver.offset) ? `t:${index}` : "";
  }
  // A subdivided driver carries its subdivision in the key so that changing the
  // subdivision live always reads as a new event, and so the keys an undivided
  // driver produces are byte-for-byte the ones the conformance corpus recorded.
  const divide = driverDivide(driver);
  const suffix = divide > 1 ? `/${divide}` : "";
  if (driver.type === "downbeat") {
    const index = subdividedIndex(frame.barIndex, frame.barPhase, divide);
    return driverFiresOn(index, driver.every, driver.offset) ? `d${suffix}:${index}` : "";
  }
  const index = subdividedIndex(frame.beatIndex, frame.beatPhase, divide);
  return driverFiresOn(index, driver.every, driver.offset) ? `b${suffix}:${index}` : "";
}

type EnvelopeTimes = {
  attackSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
};

/**
 * The ramp control read as a MOTION PROFILE, for one-shot linear transitions.
 *
 * A pulse envelope and a transition are two different things wearing the same
 * three-thumb control, and this is the second reading:
 *
 * - attack is the EASE-IN — the stretch the motion spends accelerating,
 * - hold is the FLAT middle — constant velocity, no acceleration either way,
 * - release is the EASE-OUT — the stretch it spends decelerating,
 *
 * and the transition therefore lasts exactly `attack + hold + release`. Returns
 * progress from 0 to 1.
 *
 * Concretely this is a trapezoidal velocity profile integrated once. Peak
 * velocity is whatever makes the area under it exactly 1, so the transition
 * always completes on time no matter how the three phases are proportioned:
 * lengthening the ease-in does not overshoot, it just makes the middle faster.
 *
 * Zero-length phases are skipped rather than divided by, so a bare release is a
 * pure ease-out and an all-zero ramp is an instant cut.
 */
export function phonoscopeTransitionRamp(
  elapsedSeconds: number,
  attackSeconds: number,
  holdSeconds: number,
  releaseSeconds: number,
) {
  const attack = Math.max(0, finite(attackSeconds, 0));
  const hold = Math.max(0, finite(holdSeconds, 0));
  const release = Math.max(0, finite(releaseSeconds, 0));
  const total = attack + hold + release;
  const elapsed = Math.max(0, finite(elapsedSeconds, 0));
  if (!(total > 0) || elapsed >= total) return 1;
  // Half of each ramp's span carries half its velocity: the area of a triangle.
  const peak = 1 / (attack / 2 + hold + release / 2);
  if (elapsed < attack) return clamp01(peak * elapsed * elapsed / (2 * attack));
  if (elapsed < attack + hold) return clamp01(peak * (attack / 2 + (elapsed - attack)));
  const decelerating = elapsed - attack - hold;
  return clamp01(peak * (
    attack / 2 + hold + decelerating - decelerating * decelerating / (2 * release)
  ));
}

/**
 * A pulse driver runs a triggered attack/hold/release envelope: the event
 * starts the attack, and the shape from there is entirely the authored
 * envelope. That is what makes "every 4th downbeat" mean something a decaying
 * beat pulse could not express, and it is why timer and song can be drivers at
 * all — they supply an instant, not a shape.
 *
 * Retriggering mid-flight restarts the attack from wherever the level currently
 * is rather than from zero, so fast repeats glide instead of clicking.
 */
function advancePulseEnvelope(
  state: PhonoscopeDriverState,
  times: EnvelopeTimes,
  delta: number,
  eventKey: string,
) {
  const triggered = Boolean(eventKey) && eventKey !== state.eventKey;
  if (triggered) {
    state.eventKey = eventKey;
    state.phase = "attack";
    state.holdRemaining = Math.max(0, times.holdSeconds);
  }
  // Phases are walked within the tick, each consuming the time it needs, so a
  // zero-length attack or hold does not cost a frame. Four steps is enough to
  // cross attack, hold, release and land on idle.
  let remaining = delta;
  for (let step = 0; step < 4 && remaining > 0 && state.phase !== "idle"; step += 1) {
    if (state.phase === "attack") {
      if (times.attackSeconds <= 0) {
        state.level = 1;
        state.phase = "hold";
        continue;
      }
      const needed = (1 - state.level) * times.attackSeconds;
      if (remaining >= needed) {
        state.level = 1;
        remaining -= needed;
        state.phase = "hold";
      } else {
        state.level += remaining / times.attackSeconds;
        remaining = 0;
      }
    } else if (state.phase === "hold") {
      // An envelope never starts releasing on the tick it was triggered, so
      // even an all-zero envelope reads as one frame at full strength rather
      // than vanishing between samples.
      if (triggered) break;
      if (state.holdRemaining <= 0) {
        state.phase = "release";
        continue;
      }
      const used = Math.min(remaining, state.holdRemaining);
      state.holdRemaining -= used;
      remaining -= used;
      if (state.holdRemaining <= 0) state.phase = "release";
    } else {
      if (times.releaseSeconds <= 0) {
        state.level = 0;
        state.phase = "idle";
        continue;
      }
      const needed = state.level * times.releaseSeconds;
      if (remaining >= needed) {
        state.level = 0;
        remaining = 0;
        state.phase = "idle";
      } else {
        state.level -= remaining / times.releaseSeconds;
        remaining = 0;
      }
    }
  }
  if (state.phase === "idle") state.level = 0;
  return clamp01(state.level);
}

/**
 * A continuous driver follows its level instead of being triggered by it, so
 * the envelope acts as a rate limit: attack caps how fast it can rise, hold
 * delays a fall that follows a rise, release caps how fast it drops. This is
 * the behaviour the pre-lane parameter sources had, preserved exactly.
 */
function advanceFollower(
  state: PhonoscopeDriverState,
  times: EnvelopeTimes,
  delta: number,
  signal: number,
) {
  state.target = signal;
  const rising = state.target >= state.current;
  if (rising) {
    state.holdRemaining = Math.max(0, times.holdSeconds);
  } else if (state.holdRemaining > 0) {
    state.holdRemaining -= delta;
    return state.current;
  }
  const duration = rising ? times.attackSeconds : times.releaseSeconds;
  if (duration <= 0) {
    state.current = state.target;
  } else {
    const step = delta / duration;
    state.current = rising
      ? Math.min(state.target, state.current + step)
      : Math.max(state.target, state.current - step);
  }
  return clamp01(state.current);
}

/**
 * `random` is a pulse whose timing is jittered: it fires exactly once per
 * cadence window, at a point drawn at random from inside that window, and draws
 * a new point when the window rolls over. So a `downbeat` random driver fires
 * somewhere before the next downbeat, and the downbeat resets where it will
 * fire next time.
 *
 * It runs the binding's envelope like every other pulse — the randomness is in
 * *when*, not in the shape. Randomising the value it drives to is a separate,
 * stackable thing: the binding's `randomValue`.
 *
 * The threshold is seeded from the slot key and the window, so every engine
 * jitters identically for the same window of the same track.
 */
function advanceJitteredPulse(
  state: PhonoscopeDriverState,
  driver: PhonoscopeDriver,
  binding: PhonoscopeEffectBinding,
  frame: PhonoscopeSignalFrame,
  delta: number,
  key: string,
) {
  const cadence = randomCadenceDriver(driver);
  const times = envelopeTimes(binding);
  const position = driverWindowPosition(cadence, frame);
  // A song has no interior to place a fire inside, so a song-cadence random
  // driver is simply the song pulse. Better than pretending to jitter.
  if (!position) {
    return advancePulseEnvelope(state, times, delta, pulseEventKey(cadence, frame, state));
  }

  const divide = driverDivide(cadence);
  const prefix = cadence.type === "downbeat" ? "d" : cadence.type === "timer" ? "t" : "b";
  const windowKey = `r${prefix}${divide > 1 ? `/${divide}` : ""}:${position.index}`;
  if (windowKey !== state.windowKey) {
    state.windowKey = windowKey;
    state.target = seedFraction(stablePhonoscopeSeed(`${key}:${windowKey}`));
    state.fired = false;
  }

  let eventKey = "";
  if (!state.fired && position.fraction >= state.target) {
    state.fired = true;
    // The `!` keeps a fire distinct from the window it belongs to, so the
    // envelope's "is this a new event" test can never confuse the two.
    eventKey = `${windowKey}!`;
  }
  return advancePulseEnvelope(state, times, delta, eventKey);
}

function envelopeTimes(binding: PhonoscopeEffectBinding): EnvelopeTimes {
  return {
    attackSeconds: Math.max(0, finite(binding.attackSeconds ?? 0.05, 0.05)),
    holdSeconds: Math.max(0, finite(binding.holdSeconds ?? 0, 0)),
    releaseSeconds: Math.max(0, finite(binding.releaseSeconds ?? 0.6, 0.6)),
  };
}

/** One driver's 0..1 contribution to its lane this tick. */
function driverSignal(
  driver: PhonoscopeDriver,
  binding: PhonoscopeEffectBinding,
  frame: PhonoscopeSignalFrame,
  states: PhonoscopeDriverStates,
  key: string,
) {
  const state = stateFor(states, key);
  const delta = Math.max(1 / 120, Math.min(0.25, finite(frame.delta, 1 / 60)));
  if (driver.type === "random") {
    return advanceJitteredPulse(state, driver, binding, frame, delta, key);
  }
  if (isPulseDriver(driver)) {
    return advancePulseEnvelope(state, envelopeTimes(binding), delta, pulseEventKey(driver, frame, state));
  }
  return advanceFollower(state, envelopeTimes(binding), delta, levelSignal(driver, frame));
}

/**
 * The lanes and scalars of several settings groups, merged in the order the
 * colour group entry named them: lanes stack, scalars layer.
 */
export function mergePhonoscopeSettingsGroups(groups: PhonoscopeSettingsGroup[]) {
  const lanes: { groupId: string; lane: PhonoscopeDriverLane }[] = [];
  const combine: Record<string, PhonoscopeCombineMode> = {};
  const staticSettings: Record<string, number> = {};
  for (const group of groups) {
    for (const lane of group.lanes ?? []) lanes.push({ groupId: group.id, lane });
    // A later group in the entry's list wins any scalar the earlier ones also
    // set, so reading the list top to bottom reads as layering.
    Object.assign(combine, group.combine ?? {});
    Object.assign(staticSettings, group.staticSettings ?? {});
  }
  return { lanes, combine, staticSettings };
}

type Contribution = {
  amount: number;
  period: number;
  restingValue: number;
};

/**
 * How far up its range a binding reaches this tick, 0..1.
 *
 * Normally 1 — the lane sweeps the whole authored range. With `randomValue` the
 * top of the sweep is drawn at random on each lane event and held until the
 * next one, so the envelope still ramps from the bottom of the range but stops
 * somewhere new every time.
 *
 * The draw is keyed off the primary driver's event key, which changes exactly
 * when the lane fires. Each binding draws from its own slot key, so two
 * randomised effects in one lane move independently rather than in lockstep.
 *
 * A continuous driver never writes an event key, so a level-driven lane draws
 * once and holds it — there is no event to re-draw on. The UI says so.
 */
function randomValueScale(
  binding: PhonoscopeEffectBinding,
  states: PhonoscopeDriverStates,
  slot: string,
) {
  if (!binding.randomValue) return 1;
  const roll = stateFor(states, `${slot}:rnd`);
  const eventKey = states.get(`${slot}:0`)?.eventKey ?? "";
  if (!roll.seeded || eventKey !== roll.eventKey) {
    roll.seeded = true;
    roll.eventKey = eventKey;
    roll.target = seedFraction(stablePhonoscopeSeed(`${slot}:rnd:${eventKey}`));
  }
  return roll.target;
}

/**
 * Resolve every effect the given lanes drive.
 *
 * A binding maps its lane's signal across `[min, max]`, so on its own it
 * behaves exactly as a single pre-lane parameter source did. Stacking is
 * expressed as contribution *above* a shared resting value — the highest `min`
 * among the effect's bindings — so two resting bindings never double their
 * floor, and `add` genuinely means "this much more on top".
 */
export function evaluatePhonoscopeDriverLanes(input: {
  lanes: { groupId: string; lane: PhonoscopeDriverLane }[];
  combine: Record<string, PhonoscopeCombineMode>;
  declarations: Map<string, PhonoscopeEffectDeclaration>;
  frame: PhonoscopeSignalFrame;
  states: PhonoscopeDriverStates;
}): { values: Record<string, number>; driven: Set<string> } {
  const { lanes, combine, declarations, frame, states } = input;
  const contributions = new Map<string, Contribution[]>();

  for (const { groupId, lane } of lanes) {
    const lanePeriod = driverPeriodSeconds(lane.driver, frame);
    for (const binding of lane.bindings ?? []) {
      const declaration = declarations.get(binding.effect);
      if (!declaration) continue;
      const low = clampToDeclaration(declaration, binding.min ?? declaration.min);
      const high = Math.max(low, clampToDeclaration(declaration, binding.max ?? declaration.max));
      const slot = `${groupId}:${lane.id}:${binding.id}`;
      let signal = driverSignal(lane.driver, binding, frame, states, `${slot}:0`);
      // Modifiers add to the main driver rather than gating it, so "downbeat
      // plus bass" reads as the hit sitting on top of whatever the bass is
      // already doing.
      (lane.modifiers ?? []).forEach((modifier, index) => {
        signal += driverSignal(modifier, binding, frame, states, `${slot}:${index + 1}`);
      });
      signal = Math.max(0, Math.min(PHONOSCOPE_MAX_LANE_SIGNAL, signal));
      const reach = randomValueScale(binding, states, slot);
      const list = contributions.get(binding.effect) ?? [];
      list.push({ amount: (high - low) * signal * reach, period: lanePeriod, restingValue: low });
      contributions.set(binding.effect, list);
    }
  }

  const values: Record<string, number> = {};
  const driven = new Set<string>();
  for (const [effect, list] of contributions) {
    const declaration = declarations.get(effect);
    if (!declaration || list.length === 0) continue;
    const mode = combineMode(effect, combine[effect]);
    let resting = list.reduce((highest, entry) => Math.max(highest, entry.restingValue), -Infinity);
    let total = 0;
    if (mode === "override") {
      // A replacement, not a contribution: the last lane in merge order takes
      // the effect outright and brings its OWN resting value with it, rather
      // than sitting on the shared floor every other mode builds from. That is
      // what makes an override settings group beat the defaults instead of
      // adding to them.
      const winner = list[list.length - 1];
      resting = winner.restingValue;
      total = winner.amount;
    } else if (mode === "add") {
      total = list.reduce((sum, entry) => sum + entry.amount, 0);
    } else {
      // One firing lane takes the effect outright, chosen by how often it
      // fires: `strongest` wants the least frequent, `common` the most.
      // Equal periods fall back to lane order, last one winning, which matches
      // the way colliding scalars layer.
      //
      // A continuous driver has no period at all (0), so under `strongest` it
      // never wins outright. `common` has to exclude it explicitly for the same
      // reason inverted — otherwise a level lane, being the "most frequent"
      // thing there is, would win every time and no pulse could ever be heard.
      const rarest = mode === "strongest";
      let best: Contribution | null = null;
      for (const entry of list) {
        if (entry.amount === 0) continue;
        if (!rarest && !(entry.period > 0)) continue;
        if (!best || (rarest ? entry.period >= best.period : entry.period <= best.period)) {
          best = entry;
        }
      }
      // Nothing but continuous lanes are contributing, so `common` falls back to
      // summing them rather than going silent.
      if (!best && !rarest) total = list.reduce((sum, entry) => sum + entry.amount, 0);
      else total = best ? best.amount : 0;
    }
    const range = Math.max(0, declaration.max - declaration.min);
    const ceiling = resting + range * PHONOSCOPE_OVERSHOOT_RANGES;
    const value = resting + total;
    values[effect] = Number.isFinite(value)
      ? Math.max(declaration.min, Math.min(ceiling, value))
      : declaration.default;
    driven.add(effect);
  }
  return { values, driven };
}

/**
 * The mode an effect actually combines by.
 *
 * Override-only effects ignore whatever a settings group stored: a transition
 * cannot be half one thing and half another, so the axis is forced no matter
 * how an older configuration was authored. Anything unrecognised reads as
 * `add`, which is the behaviour every effect had before combine modes existed.
 */
function combineMode(effect: string, stored: PhonoscopeCombineMode | undefined) {
  if (isPhonoscopeOverrideOnlyEffect(effect)) return "override";
  if (stored === "strongest" || stored === "common" || stored === "override") return stored;
  return "add";
}

function clampToDeclaration(declaration: PhonoscopeEffectDeclaration, value: number) {
  const low = Math.min(declaration.min, declaration.max);
  const high = Math.max(declaration.min, declaration.max);
  const bounded = Math.max(low, Math.min(high, finite(value, declaration.default)));
  if (!(declaration.step > 0)) return bounded;
  const stepped = low + Math.round((bounded - low) / declaration.step) * declaration.step;
  return Math.max(low, Math.min(high, stepped));
}

/** A driver with every field populated, for building defaults in the UI and tests. */
export function phonoscopeDriver(partial: Partial<PhonoscopeDriver> = {}): PhonoscopeDriver {
  const requested = Math.floor(finite(partial.divide ?? 1, 1));
  const type = partial.type ?? "beat";
  const cadence = partial.cadence ?? "beat";
  // Only the two musical pulses subdivide, so switching a subdivided lane to
  // `song` or `timer` drops the subdivision rather than parking a value the
  // engines would ignore.
  const pulse = type === "random" ? cadence : type;
  const divide = PHONOSCOPE_DIVIDE_CHOICES.includes(requested)
    && (pulse === "beat" || pulse === "downbeat")
    ? requested
    : 1;
  // Counting and subdividing are the two directions of one control, so a
  // subdivided driver is always "every one" — and an offset within a cycle of
  // one is nothing at all.
  const every = divide > 1 ? 1 : Math.max(1, Math.min(16, Math.floor(finite(partial.every ?? 1, 1))));
  return {
    type,
    every,
    divide,
    // An offset only means anything inside the cycle it offsets within.
    offset: Math.max(0, Math.min(every - 1, Math.floor(finite(partial.offset ?? 0, 0)))),
    intervalSeconds: Math.max(0.25, Math.min(600, finite(partial.intervalSeconds ?? 4, 4))),
    cadence,
  };
}
