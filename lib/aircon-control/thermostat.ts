import type { AirconAutoPlanInput, AirconAutoState } from "./types";
import { createInitialAirconAutoState } from "./cycle-model";
import { planAirconAutoTick } from "./plan-model";

export class AirconAutoThermostat {
  private state = createInitialAirconAutoState();

  reset() {
    this.state = createInitialAirconAutoState();
  }

  /**
   * Clear the per-cycle bookkeeping for a user request WITHOUT clearing the
   * guards.
   *
   * reset() used to run on every autoMode transition, and on
   * a compressor that must not also wipe the dwell, the direction hold and the
   * start history — that is exactly how the bedroom heater ended up flapping
   * a 2 kW relay three times in twelve seconds on 2026-08-08. Breaking the
   * direction hold is a deliberate act with its own rules (see ClimateControls),
   * not a side effect of pressing a button.
   */
  resetForUserRequest() {
    this.state = {
      ...createInitialAirconAutoState(),
      lastMode: this.state.lastMode,
      lastModeAt: this.state.lastModeAt,
      lastTransitionAt: this.state.lastTransitionAt,
      recentStartsAt: this.state.recentStartsAt,
      settlingFromTemperature: this.state.settlingFromTemperature,
      // A press of Auto IS a user request. Clearing the latch here would drop
      // the very intent that caused this call.
      userRequestAt: this.state.userRequestAt,
    };
  }

  snapshot() {
    return { ...this.state };
  }

  /**
   * Fold durable cycle state (from preferences) into memory, keeping whichever
   * copy is further ahead. Preferences are shared across clients and survive a
   * reload; memory is fresher than the ≤5 s snapshot. Neither alone is enough.
   */
  reconcile(durable: Partial<AirconAutoState>) {
    const later = (a: number | null | undefined, b: number | null | undefined) =>
      Math.max(a ?? 0, b ?? 0) || null;
    const durableModeAt = durable.lastModeAt ?? 0;
    const memoryModeAt = this.state.lastModeAt ?? 0;
    const durableTransitionAt = durable.lastTransitionAt ?? 0;
    const memoryTransitionAt = this.state.lastTransitionAt ?? 0;
    this.state = {
      ...this.state,
      lastTransitionAt: later(this.state.lastTransitionAt, durable.lastTransitionAt),
      lastModeAt: later(memoryModeAt, durableModeAt),
      // The direction belongs to whichever hold started later, so a flip written
      // by another client is not silently reverted by this one's stale memory.
      lastMode: durableModeAt > memoryModeAt ? durable.lastMode ?? this.state.lastMode : this.state.lastMode,
      recentStartsAt: Array.from(new Set([...this.state.recentStartsAt, ...(durable.recentStartsAt ?? [])])),
      sensorPendingSinceAt: this.state.sensorPendingSinceAt ?? durable.sensorPendingSinceAt ?? null,
      // Our own latch wins while we hold one. Otherwise adopt the durable one
      // only if it was latched AFTER our last transition — a request this
      // process has already served leaves null in memory, and a preferences
      // copy written just before that action must not resurrect it.
      userRequestAt:
        this.state.userRequestAt ??
        ((durable.userRequestAt ?? 0) > memoryTransitionAt ? durable.userRequestAt ?? null : null),
      lastTargetTemperature: this.state.lastTargetTemperature ?? durable.lastTargetTemperature ?? null,
      settlingFromTemperature:
        durableTransitionAt > memoryTransitionAt
          ? durable.settlingFromTemperature ?? null
          : memoryTransitionAt > durableTransitionAt
            ? this.state.settlingFromTemperature
            : this.state.settlingFromTemperature ?? durable.settlingFromTemperature ?? null,
    };
  }

  plan(args: Omit<AirconAutoPlanInput, "state">) {
    const plan = planAirconAutoTick({ ...args, state: this.state });
    this.state = plan.nextState;
    return plan;
  }
}
