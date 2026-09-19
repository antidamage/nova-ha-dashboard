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
    // We do not heat blind (Adeline, 2026-09-19: "we don't run heating or cooling
    // blind. but we do leave the goddamn mode selected in case a temp value comes
    // back"). With no usable room reading there is nothing to aim at, so the
    // element switches off and Auto waits — it used to heat on a guess for two
    // minutes and then switch Auto itself off, which needed a human to re-arm.
    //
    // Idempotent: no actions once the heater is already off, so the loop can sit
    // here indefinitely and pick the room up the moment a reading returns.
    const pendingState: BedroomHeaterAutoState = {
      ...active,
      // When the reading went missing, for the public state. Nothing expires off
      // the back of it, and only an actual stop moves the dwell clock.
      sensorPendingSinceAt: active.sensorPendingSinceAt ?? now,
      ...(input.isOn ? { lastTransitionAt: now } : {}),
    };
    return {
      actions: input.isOn ? [turnOff(entityId)] : [],
      nextState: pendingState,
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
