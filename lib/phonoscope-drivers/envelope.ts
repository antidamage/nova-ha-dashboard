import type { PhonoscopeEffectBinding } from "../types";
import { clamp01, finite } from "./signal-model";
import type { EnvelopeTimes, PhonoscopeDriverState } from "./types";

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
export function advancePulseEnvelope(
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
export function advanceFollower(
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


export function envelopeTimes(binding: PhonoscopeEffectBinding): EnvelopeTimes {
  return {
    attackSeconds: Math.max(0, finite(binding.attackSeconds ?? 0.05, 0.05)),
    holdSeconds: Math.max(0, finite(binding.holdSeconds ?? 0, 0)),
    releaseSeconds: Math.max(0, finite(binding.releaseSeconds ?? 0.6, 0.6)),
  };
}

