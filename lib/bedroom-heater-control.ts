import type { BedroomHeaterMode, BedroomHeaterPreferences } from "./types";
import { autonomousClimateInputIsUsable } from "./autonomous-climate-safety";

/*
 * Dashboard bedroom-heater control rules.
 *
 * Like lib/aircon-control.ts this file is deliberately React-free and
 * Home-Assistant-UI-free: the component renders controls, but the behavior that
 * decides on/off lives here so it can also run on the server.
 *
 * The bedroom heater differs from the air conditioner in three ways that shape
 * everything below:
 *
 *   1. It is a bare switch. There is no setpoint on the appliance, so "target
 *      temperature" is a Nova concept only, and the sole outputs are
 *      switch.turn_on / switch.turn_off. Heat-only: we can warm the room but
 *      never cool it, so being too hot means "off", not "cool".
 *
 *   2. Its temperature comes from a standalone room puck, NOT from the switch.
 *      The switch has an onboard sensor and Nova used it until 2026-08-08, when
 *      a co-located reference showed it moving 0.84 C while the room moved
 *      4.8 C — too damped to close a loop around, and unfixable by calibration.
 *      The Bedroom sensor is the sole authority. The configured list is
 *      retained for discovery/config compatibility, but it must contain this
 *      entity; a plug sensor is never an acceptable fallback.
 *
 *      The former post-target tail was removed with that change. A puck across
 *      the room does not lead the air through appliance self-heating, so the
 *      relay now cuts immediately at target.
 *
 *   3. It is a 2 kW resistive load on a relay. Short-cycling wears the relay
 *      and does nothing useful, so a minimum dwell time gates every transition.
 *      This is why the loop can tick slowly and must never be "corrected" into
 *      a fast one.
 *
 * The auto window is the other half, and it is a SCHEDULE, not a gate. Its
 * endpoints are auto-on and auto-off times (minutes from midday, see
 * BedroomHeaterPreferences), and all they do is flip the mode as the clock
 * crosses them: at auto-on the mode becomes "auto", at auto-off it becomes
 * "off". Between those edges whatever the user last chose stands — pressing
 * Auto at three in the afternoon heats the room at three in the afternoon.
 *
 * It was a gate once, and that was wrong: the planner asked "are we inside the
 * window?" on every tick, so a user pressing Auto outside it was switched
 * straight back off. User input outranks the schedule; the schedule only moves
 * the mode when the clock reaches an endpoint.
 */

export const BEDROOM_HEATER_AUTO_POLL_MS = 30_000;
export const BEDROOM_HEATER_BAND_DEGREES = 0.5;
export const BEDROOM_HEATER_MIN_CYCLE_MS = 10 * 60_000;
/** Compatibility export: the remote room puck requires no post-target tail. */
export const BEDROOM_HEATER_TAIL_OFF_MS = 0;
/**
 * How long Auto is allowed to run with NO usable room-temperature reading
 * before it fails safe. Same rationale as AIRCON_AUTO_SENSOR_GRACE_MS in
 * lib/aircon-control.ts: failing safe the instant a reading is missing would
 * mean Auto can never turn itself on from cold if the sensor is slow to
 * populate. This grace window lets it try heating first (heat-only, so there
 * is only one direction to guess); only if the sensor is STILL unusable after
 * it does the heater switch off. The unified controller then clears Auto so it
 * cannot retry without a later user action or schedule edge.
 */
export const BEDROOM_HEATER_SENSOR_GRACE_MS = 2 * 60_000;
export const BEDROOM_HEATER_DEFAULT_TARGET_C = 18;
export const BEDROOM_HEATER_MIN_TARGET_C = 5;
export const BEDROOM_HEATER_MAX_TARGET_C = 30;

/** Minutes from midday. 0 = 12:00 today, 720 = 00:00, 1440 = 12:00 tomorrow. */
export const BEDROOM_HEATER_WINDOW_MAX_MINUTES = 1440;
export const BEDROOM_HEATER_WINDOW_STEP_MINUTES = 15;
export const BEDROOM_HEATER_DEFAULT_AUTO_ON_MINUTES = 360; // 18:00
export const BEDROOM_HEATER_DEFAULT_AUTO_OFF_MINUTES = 1140; // 07:00 next day

/** The relocated standalone room sensor; never substitute the plug sensor. */
export const BEDROOM_ROOM_TEMPERATURE_ENTITY_ID = "sensor.tuya_mobile_bedroom_sensor_temperature";

/**
 * Return the only temperature source permitted to drive or display Bedroom.
 * An unavailable room sensor therefore disables Auto rather than silently
 * substituting the plug's switch-body temperature.
 */
export function bedroomRoomTemperatureEntityIds(entityIds: readonly string[]) {
  return entityIds.includes(BEDROOM_ROOM_TEMPERATURE_ENTITY_ID)
    ? [BEDROOM_ROOM_TEMPERATURE_ENTITY_ID]
    : [];
}

export function bedroomTemperatureStateIsFresh(
  state: { attributes?: Record<string, unknown>; last_reported?: string; last_updated?: string; last_changed?: string } | null | undefined,
  now: number = Date.now(),
) {
  const sourceReportedAt = state?.attributes?.source_reported_at;
  return autonomousClimateInputIsUsable(
    state ? {
      ...state,
      last_reported: typeof sourceReportedAt === "string" ? sourceReportedAt : state.last_reported,
      measurement: 0,
      sourceState: "available",
    } : undefined,
    now,
  );
}

export function bedroomTemperatureStateIsUsable(
  state: { state?: string; attributes?: Record<string, unknown>; last_reported?: string; last_updated?: string; last_changed?: string } | null | undefined,
  now: number = Date.now(),
) {
  const sourceReportedAt = state?.attributes?.source_reported_at;
  return autonomousClimateInputIsUsable(
    state ? {
      ...state,
      last_reported: typeof sourceReportedAt === "string" ? sourceReportedAt : state.last_reported,
      measurement: state.state,
      sourceState: state.state,
    } : undefined,
    now,
  );
}

export type BedroomHeaterAction = {
  entityId: string;
  domain: "switch";
  service: "turn_on" | "turn_off";
};

export type BedroomHeaterAutoState = {
  /** When the switch last changed state, for min-cycle enforcement. */
  lastTransitionAt: number | null;
  /** Set once the room first reaches target, cleared when it drifts back out. */
  enteredBandAt: number | null;
  /** Legacy compatibility bit: true after the immediate at-target stop. */
  tailedOff: boolean;
  /** Tracks the target so a user's new setpoint reopens a settled cycle. */
  lastTargetTemperature: number | null;
  /**
   * When Auto first started trying to run without a usable sensor reading.
   * Null once a usable reading arrives or the fail-safe fires. Bounds
   * BEDROOM_HEATER_SENSOR_GRACE_MS — see its comment above.
   */
  sensorPendingSinceAt: number | null;
};

export const INITIAL_BEDROOM_HEATER_AUTO_STATE: BedroomHeaterAutoState = {
  lastTransitionAt: null,
  enteredBandAt: null,
  tailedOff: false,
  lastTargetTemperature: null,
  sensorPendingSinceAt: null,
};

export function createInitialBedroomHeaterAutoState(): BedroomHeaterAutoState {
  return { ...INITIAL_BEDROOM_HEATER_AUTO_STATE };
}

export function clampTargetTemperature(value: number) {
  return Math.min(BEDROOM_HEATER_MAX_TARGET_C, Math.max(BEDROOM_HEATER_MIN_TARGET_C, value));
}

export function clampWindowMinutes(value: number) {
  return Math.min(BEDROOM_HEATER_WINDOW_MAX_MINUTES, Math.max(0, Math.round(value)));
}

/**
 * Minutes elapsed since the most recent midday, in 0..1440. This is the same
 * axis the stored window uses, so comparisons are plain numeric ones.
 */
export function minutesFromMidday(now: Date) {
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  return (minutesSinceMidnight + 720) % 1440;
}

/** How far forward from `from` to `to` on the 1440-minute circle. */
function forwardMinutes(from: number, to: number) {
  return (to - from + BEDROOM_HEATER_WINDOW_MAX_MINUTES) % BEDROOM_HEATER_WINDOW_MAX_MINUTES;
}

/**
 * Which schedule endpoint, if any, the clock crossed between two observations.
 *
 * Both endpoints are checked on the forward arc from `previousMinutes` to
 * `nowMinutes`, so a long stall (a sleeping host, a slow restart) that skips
 * over both still lands on the correct final mode: whichever edge is later on
 * that arc wins. Returns null when nothing was crossed, which is the answer on
 * almost every tick.
 */
export function bedroomHeaterScheduleEdge(
  previousMinutes: number,
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): "auto" | "off" | null {
  if (previousMinutes === nowMinutes || startMinutes === endMinutes) {
    return null;
  }

  const span = forwardMinutes(previousMinutes, nowMinutes);
  const toStart = forwardMinutes(previousMinutes, startMinutes);
  const toEnd = forwardMinutes(previousMinutes, endMinutes);
  // Half-open: an edge exactly at `previousMinutes` was already applied.
  const crossedStart = toStart > 0 && toStart <= span;
  const crossedEnd = toEnd > 0 && toEnd <= span;

  if (crossedStart && crossedEnd) {
    return toStart > toEnd ? "auto" : "off";
  }
  if (crossedStart) {
    return "auto";
  }
  return crossedEnd ? "off" : null;
}

export function formatMinutesFromMidday(minutes: number) {
  const clamped = clampWindowMinutes(minutes);
  const totalMinutes = (clamped + 720) % 1440;
  const hours24 = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const suffix = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const nextDay = clamped >= 720;
  return `${hours12}:${mins.toString().padStart(2, "0")} ${suffix}${nextDay ? " +1" : ""}`;
}

/**
 * The stored mode, with the retired "manual" folded into "auto".
 *
 * Manual meant "hold the switch on regardless of temperature", which is what
 * Auto already does when the room is cold — the difference was never visible to
 * anyone, so the button went. Existing preferences still carry it, and the
 * honest reading of a heater someone left on is Auto, not Off.
 */
export function bedroomHeaterMode(preferences?: BedroomHeaterPreferences): BedroomHeaterMode {
  return preferences?.mode === "auto" || preferences?.mode === "manual" ? "auto" : "off";
}

export function bedroomHeaterTargetTemperature(preferences?: BedroomHeaterPreferences) {
  const value = preferences?.temperature;
  return typeof value === "number" && Number.isFinite(value)
    ? clampTargetTemperature(value)
    : BEDROOM_HEATER_DEFAULT_TARGET_C;
}

export function bedroomHeaterWindow(preferences?: BedroomHeaterPreferences) {
  const start =
    typeof preferences?.autoOnMinutes === "number"
      ? clampWindowMinutes(preferences.autoOnMinutes)
      : BEDROOM_HEATER_DEFAULT_AUTO_ON_MINUTES;
  const end =
    typeof preferences?.autoOffMinutes === "number"
      ? clampWindowMinutes(preferences.autoOffMinutes)
      : BEDROOM_HEATER_DEFAULT_AUTO_OFF_MINUTES;
  return { start, end };
}

/**
 * Sleep-timer endpoint as a number, or null when no timer is set. Unparseable
 * values are treated as "no timer" rather than "expired": a corrupt preference
 * must never be the reason the heater shuts off.
 */
export function bedroomHeaterSleepTimerEndsAt(preferences?: BedroomHeaterPreferences) {
  const value = preferences?.offTimerEndsAt;
  if (typeof value !== "string") {
    return null;
  }
  const endsAt = new Date(value).getTime();
  return Number.isFinite(endsAt) ? endsAt : null;
}

export function bedroomHeaterSleepTimerExpired(
  preferences?: BedroomHeaterPreferences,
  now: number = Date.now(),
) {
  const endsAt = bedroomHeaterSleepTimerEndsAt(preferences);
  return endsAt !== null && endsAt <= now;
}

export type BedroomHeaterPlanInput = {
  currentTemperature: number | null;
  entityId?: string;
  isOn: boolean;
  now?: number;
  preferences?: BedroomHeaterPreferences;
  state?: BedroomHeaterAutoState;
};

export type BedroomHeaterPlan = {
  actions: BedroomHeaterAction[];
  nextState: BedroomHeaterAutoState;
  /** Why the planner did what it did, for the monitoring stream. */
  reason: string;
};

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
