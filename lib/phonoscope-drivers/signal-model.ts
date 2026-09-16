import type { PhonoscopeDriver } from "../types";
import type { PhonoscopeDriverState, PhonoscopeDriverStates, PhonoscopeSignalFrame } from "./types";

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

export function finite(value: number, fallback: number) {
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
export function subdividedIndex(index: number, phase: number, divide: number) {
  if (divide <= 1) return Math.floor(finite(index, 0));
  const position = Math.floor(finite(index, 0)) + Math.max(0, Math.min(1, finite(phase, 0)));
  return Math.floor(position * divide);
}

/**
 * The pulse a `random` driver's window is measured in. An unrecognised cadence
 * reads as `beat`, so a configuration from a newer dashboard degrades to the
 * commonest window rather than to silence.
 */
export function randomCadenceDriver(driver: PhonoscopeDriver): PhonoscopeDriver {
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
export function driverWindowPosition(
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
export function levelSignal(driver: PhonoscopeDriver, frame: PhonoscopeSignalFrame) {
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

export function clamp01(value: number) {
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

export function stateFor(states: PhonoscopeDriverStates, key: string) {
  let state = states.get(key);
  if (!state) {
    state = emptyState();
    states.set(key, state);
  }
  return state;
}

