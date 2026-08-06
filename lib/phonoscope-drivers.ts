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
/** The centre image's base height, as a percentage of the frame. */
export const PHONOSCOPE_CENTRE_HEIGHT_EFFECT = "__centreHeight";
export const PHONOSCOPE_HUE_OFFSET_EFFECT = "__hueOffset";
export const PHONOSCOPE_THEME_CHANGE_EFFECT = "__themeChange";
/** Frame geometry and the vignette framing it. */
export const PHONOSCOPE_BG_HEIGHT_EFFECT = "__bgHeight";
export const PHONOSCOPE_BG_WIDTH_EFFECT = "__bgWidth";
export const PHONOSCOPE_VIGNETTE_OPACITY_EFFECT = "__vignetteOpacity";
export const PHONOSCOPE_VIGNETTE_SIZE_EFFECT = "__vignetteSize";
/** How the scene layer meets the backdrop. */
export const PHONOSCOPE_SCENE_BLEND_EFFECT = "__sceneBlend";

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

export function isPulseDriver(driver: PhonoscopeDriver) {
  return PULSE_TYPES.has(driver.type);
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

/**
 * How rarely a lane fires, in seconds, used to rank lanes when an effect
 * combines by `strongest`. Longer wins, so an every-4th-downbeat hit covers a
 * plain downbeat, which covers a beat. Continuous drivers never win outright.
 */
export function driverPeriodSeconds(driver: PhonoscopeDriver, frame: PhonoscopeSignalFrame) {
  const every = Math.max(1, Math.floor(finite(driver.every, 1)));
  const secondsPerBeat = Math.max(1e-6, finite(frame.secondsPerBeat, 0.5));
  const beatsPerBar = Math.max(1, finite(frame.beatsPerBar, 4));
  switch (driver.type) {
    // A song is the rarest thing that can happen, and its length is unknown
    // ahead of time, so it always outranks a counted pulse.
    case "song": return Number.POSITIVE_INFINITY;
    case "timer": return every * Math.max(0.25, finite(driver.intervalSeconds, 4));
    case "downbeat": return every * beatsPerBar * secondsPerBeat;
    case "beat": return every * secondsPerBeat;
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
  if (driver.type === "downbeat") {
    const index = Math.floor(finite(frame.barIndex, 0));
    return driverFiresOn(index, driver.every, driver.offset) ? `d:${index}` : "";
  }
  const index = Math.floor(finite(frame.beatIndex, 0));
  return driverFiresOn(index, driver.every, driver.offset) ? `b:${index}` : "";
}

type EnvelopeTimes = {
  attackSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
};

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
 * `random` samples a new value on its cadence and glides to it over
 * `transitionSeconds`, ignoring the binding envelope — the cadence and the
 * glide are the shape. The sample is seeded from the slot key and the event, so
 * every engine picks the same value for the same beat of the same track.
 */
function advanceRandom(
  state: PhonoscopeDriverState,
  driver: PhonoscopeDriver,
  frame: PhonoscopeSignalFrame,
  delta: number,
  key: string,
) {
  const cadence: PhonoscopeDriver = {
    ...driver,
    type: driver.cadence === "beat" || driver.cadence === "downbeat"
      || driver.cadence === "timer" || driver.cadence === "song"
      ? driver.cadence
      : "beat",
  };
  const eventKey = pulseEventKey(cadence, frame, state);
  if (eventKey && eventKey !== state.eventKey) {
    state.eventKey = eventKey;
    state.target = seedFraction(stablePhonoscopeSeed(`${key}:${eventKey}`));
  }
  const duration = Math.max(0, finite(driver.transitionSeconds, 0.5));
  const amount = duration === 0 ? 1 : Math.min(1, delta / duration);
  state.current += (state.target - state.current) * amount;
  return clamp01(state.current);
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
  if (driver.type === "random") return advanceRandom(state, driver, frame, delta, key);
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
      const list = contributions.get(binding.effect) ?? [];
      list.push({ amount: (high - low) * signal, period: lanePeriod, restingValue: low });
      contributions.set(binding.effect, list);
    }
  }

  const values: Record<string, number> = {};
  const driven = new Set<string>();
  for (const [effect, list] of contributions) {
    const declaration = declarations.get(effect);
    if (!declaration || list.length === 0) continue;
    const resting = list.reduce((highest, entry) => Math.max(highest, entry.restingValue), -Infinity);
    const mode = combine[effect] === "strongest" ? "strongest" : "add";
    let total = 0;
    if (mode === "add") {
      total = list.reduce((sum, entry) => sum + entry.amount, 0);
    } else {
      // The rarest lane that is actually firing takes the effect outright.
      // Equal periods fall back to lane order, last one winning, which matches
      // the way colliding scalars layer.
      let best: Contribution | null = null;
      for (const entry of list) {
        if (entry.amount === 0) continue;
        if (!best || entry.period >= best.period) best = entry;
      }
      total = best ? best.amount : 0;
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
  const every = Math.max(1, Math.min(16, Math.floor(finite(partial.every ?? 1, 1))));
  return {
    type: partial.type ?? "beat",
    every,
    // An offset only means anything inside the cycle it offsets within.
    offset: Math.max(0, Math.min(every - 1, Math.floor(finite(partial.offset ?? 0, 0)))),
    intervalSeconds: Math.max(0.25, Math.min(600, finite(partial.intervalSeconds ?? 4, 4))),
    cadence: partial.cadence ?? "beat",
    transitionSeconds: Math.max(0, Math.min(10, finite(partial.transitionSeconds ?? 0.5, 0.5))),
  };
}
