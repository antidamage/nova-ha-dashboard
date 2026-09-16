import type { PhonoscopeDriver, PhonoscopeEffectBinding } from "../types";
import { advanceFollower, advancePulseEnvelope, envelopeTimes } from "./envelope";
import {
  driverDivide,
  driverFiresOn,
  driverWindowPosition,
  finite,
  isPulseDriver,
  levelSignal,
  randomCadenceDriver,
  seedFraction,
  stablePhonoscopeSeed,
  stateFor,
  subdividedIndex,
} from "./signal-model";
import type { PhonoscopeDriverState, PhonoscopeDriverStates, PhonoscopeSignalFrame } from "./types";

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


/** One driver's 0..1 contribution to its lane this tick. */
export function driverSignal(
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

