import {
  BEDROOM_HEATER_BAND_DEGREES,
  BEDROOM_HEATER_MIN_CYCLE_MS,
  BEDROOM_HEATER_SENSOR_GRACE_MS,
  INITIAL_BEDROOM_HEATER_AUTO_STATE,
} from "./constants";
import { bedroomHeaterTargetTemperature, createInitialBedroomHeaterAutoState } from "./inputs-model";
import type { BedroomHeaterAction, BedroomHeaterAutoState, BedroomHeaterPlan, BedroomHeaterPlanInput } from "./types";

function normalizeState(state?: BedroomHeaterAutoState): BedroomHeaterAutoState {
  return { ...INITIAL_BEDROOM_HEATER_AUTO_STATE, ...(state ?? {}) };
}

function turnOn(entityId: string): BedroomHeaterAction {
  return { entityId, domain: "switch", service: "turn_on" };
}

function turnOff(entityId: string): BedroomHeaterAction {
  return { entityId, domain: "switch", service: "turn_off" };
}

/**
 * Decide what the heater should do on this tick.
 *
 * Every return is idempotent: when the heater is already in the desired state
 * the plan is empty, so a loop that ticks forever does not re-send commands.
 */
export function planBedroomHeaterTick(input: BedroomHeaterPlanInput): BedroomHeaterPlan {
  const state = normalizeState(input.state);
  const now = input.now ?? Date.now();
  const entityId = input.entityId;
  const target = bedroomHeaterTargetTemperature(input.preferences);

  if (!entityId) {
    return { actions: [], nextState: state, reason: "no-entity" };
  }

  const active = state;

  if (input.currentTemperature === null) {
    const pendingSinceAt = active.sensorPendingSinceAt ?? now;
    const elapsedMs = now - pendingSinceAt;
    const minCycleElapsed =
      active.lastTransitionAt === null || now - active.lastTransitionAt >= BEDROOM_HEATER_MIN_CYCLE_MS;

    if (elapsedMs >= BEDROOM_HEATER_SENSOR_GRACE_MS) {
      // Ran blind for the whole grace window and still no usable reading:
      // switch off (if on). The unified controller also clears Auto.
      return {
        actions: input.isOn ? [turnOff(entityId)] : [],
        nextState: {
          ...createInitialBedroomHeaterAutoState(),
          lastTransitionAt: input.isOn ? now : active.lastTransitionAt,
          sensorPendingSinceAt: null,
        },
        reason: "sensor-fail-safe-off",
      };
    }

    // Still inside the grace window: try heating rather than sit off waiting
    // for a reading that may simply be slow to populate. Heat-only, so there
    // is only one direction to attempt. Still respects the compressor^H^H
    // relay's minimum dwell so a flapping sensor cannot short-cycle it.
    const pendingState: BedroomHeaterAutoState = { ...active, sensorPendingSinceAt: pendingSinceAt };
    if (input.isOn || !minCycleElapsed) {
      return { actions: [], nextState: pendingState, reason: "sensor-pending" };
    }
    return {
      actions: [turnOn(entityId)],
      nextState: { ...pendingState, lastTransitionAt: now },
      reason: "sensor-pending",
    };
  }

  // A new target reopens a settled cycle — otherwise a warmer setpoint would be
  // ignored until the appliance sensor happened to move.
  const targetChanged = active.lastTargetTemperature !== null && active.lastTargetTemperature !== target;
  const base: BedroomHeaterAutoState = targetChanged
    ? { ...active, enteredBandAt: null, tailedOff: false }
    : active;

  const delta = input.currentTemperature - target;
  const withinBand = Math.abs(delta) <= BEDROOM_HEATER_BAND_DEGREES;
  const tooCold = delta < -BEDROOM_HEATER_BAND_DEGREES;
  const minCycleElapsed =
    base.lastTransitionAt === null || now - base.lastTransitionAt >= BEDROOM_HEATER_MIN_CYCLE_MS;

  const nextState: BedroomHeaterAutoState = {
    ...base,
    lastTargetTemperature: target,
    // A usable reading arrived: whatever blind-attempt clock was running is moot.
    sensorPendingSinceAt: null,
  };

  if (tooCold) {
    // Below band: heat. Clearing the band marks means the next approach to
    // target gets a fresh at-target decision.
    if (input.isOn) {
      return {
        actions: [],
        nextState: { ...nextState, enteredBandAt: null, tailedOff: false },
          reason: "heating",
      };
    }
    if (!minCycleElapsed) {
      return {
        actions: [],
        nextState: { ...nextState, enteredBandAt: null, tailedOff: false },
          reason: "min-cycle-hold-off",
      };
    }
    return {
      actions: [turnOn(entityId)],
      nextState: { ...nextState, enteredBandAt: null, tailedOff: false, lastTransitionAt: now },
      reason: "heating",
    };
  }

  // The standalone puck does not self-heat with the relay. At or above target
  // therefore means stop immediately; relay dwell gates starts only.
  const enteredBandAt = withinBand ? base.enteredBandAt ?? now : null;

  if (!input.isOn) {
    return {
      actions: [],
      nextState: { ...nextState, enteredBandAt, tailedOff: true },
      reason: withinBand ? "at-target" : "above-target",
    };
  }

  return {
    actions: [turnOff(entityId)],
    nextState: { ...nextState, enteredBandAt, tailedOff: true, lastTransitionAt: now },
    reason: withinBand ? "reached-target" : "above-target",
  };
}

export class BedroomHeaterThermostat {
  private state: BedroomHeaterAutoState = createInitialBedroomHeaterAutoState();

  plan(input: Omit<BedroomHeaterPlanInput, "state">): BedroomHeaterPlan {
    const result = planBedroomHeaterTick({ ...input, state: this.state });
    this.state = result.nextState;
    return result;
  }

  reset() {
    this.state = createInitialBedroomHeaterAutoState();
  }

  /**
   * Clear the settle state so a user request is acted on now, WITHOUT clearing
   * lastTransitionAt.
   *
   * reset() used to be what ran on every user command, and that quietly
   * disabled the minimum cycle: lastTransitionAt is the only thing enforcing
   * BEDROOM_HEATER_MIN_CYCLE_MS, so wiping it re-armed the loop to switch a
   * 2 kW relay instantly. Repeated presses could then flap the relay with no
   * dwell at all (observed 2026-08-08: three turn_on commands in 12 seconds).
   *
   * The dwell guards the hardware and must survive user input. What the user
   * legitimately needs cleared is the band bookkeeping, so a fresh request
   * is not swallowed by an already-settled cycle.
   */
  resetForUserRequest() {
    this.state = {
      ...createInitialBedroomHeaterAutoState(),
      lastTransitionAt: this.state.lastTransitionAt,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  /** Restore safety state that must survive a dashboard process restart. */
  reconcile(durable: Partial<BedroomHeaterAutoState>) {
    const later = (a: number | null | undefined, b: number | null | undefined) =>
      Math.max(a ?? 0, b ?? 0) || null;
    this.state = {
      ...this.state,
      lastTransitionAt: later(this.state.lastTransitionAt, durable.lastTransitionAt),
      sensorPendingSinceAt: this.state.sensorPendingSinceAt ?? durable.sensorPendingSinceAt ?? null,
    };
  }
}
