import type { AirconPreferences, DashboardEntity, DashboardPreferences, HaDomain } from "../types";

export type EntityActionInput = {
  entityId: string;
  domain: HaDomain;
  service: string;
  data?: Record<string, unknown>;
  remember?: DashboardPreferences;
};

export type ActiveAirconMode = "heat" | "cool";

/*
 * Dashboard air-con control rules.
 *
 * This file is intentionally React-free and Home-Assistant-UI-free. The
 * dashboard component can render controls, but the behavior that decides heat,
 * cool, target temperature, fan speed, and remembered auto state lives here.
 *
 * The core invariant:
 *
 *   delta = measuredRoomTemperature - selectedTargetTemperature
 *
 * If delta is positive, the room is hotter than the target, so auto must cool.
 * If delta is negative, the room is colder than the target, so auto must heat.
 *
 * Dashboard "Auto" is not the Gree/Home Assistant HVAC auto mode. It is a tiny
 * thermostat loop owned by Nova. The loop chooses heat/cool and applies the
 * target; once the room reaches target it switches the unit OFF (homeostasis =
 * off). The dashboard still reads "Auto" because the remembered autoMode
 * preference, not the unit's on/off, drives the power display — so the unit just
 * rests off until the room drifts far enough out, at which point the loop turns
 * it on again.
 *
 * The hysteresis is asymmetric and deliberately so: cut off AT target, then
 * resume the SAME direction when either (a) a monotonic post-stop drift plus a
 * first-order equilibrium estimate says the unchanged target is still missed,
 * after the 10-minute compressor dwell, or (b) the conservative 30-minute
 * settling fallback expires. A direction reversal still needs three degrees of
 * evidence and never uses the early predictor. The last direction, transition
 * reading, and clocks are durable so every dashboard and reload agrees.
 *
 * Three transition guards sit on top, because the measurement cannot be trusted
 * to mean what it says:
 *
 *   - a 30-minute hold on changing direction (AIRCON_AUTO_MODE_HOLD_MS),
 *   - a directional first-order sensor model with a 30-minute fallback,
 *   - a 10-minute dwell before restarting the compressor,
 *
 * There is deliberately no starts-per-hour cap. Fixed Heat may heat again and
 * fixed Cool may cool again whenever the sensor model and compressor dwell
 * gates clear. The 10-minute hardware dwell remains the absolute lower bound.
 *
 * None of these guards can stop the unit turning OFF. Stopping is always safe and always
 * cheap; a guard that delays it would leave the unit driving the room the wrong
 * way. Only starting is rate-limited.
 *
 * The state below therefore has to survive a page reload, because a 30-minute
 * hold that resets whenever the kiosk reloads is not a hold. It is mirrored into
 * preferences.aircon by the same `remember` payloads the loop already writes on
 * every transition, and reconciled by the server climate controller.
 */

export type AirconAutoState = {
  /** The direction Auto last drove. Changing it is what AIRCON_AUTO_MODE_HOLD_MS holds. */
  lastMode: ActiveAirconMode | null;
  /** When that direction was chosen. */
  lastModeAt: number | null;
  /** Last on/off/mode change, for the minimum-cycle dwell. */
  lastTransitionAt: number | null;
  /** Sensor reading captured when the current off-settling transient began. */
  settlingFromTemperature: number | null;
  /** Start telemetry, oldest first, pruned to the trailing hour; never a limit. */
  recentStartsAt: number[];
  /**
   * Tracks the target so a setpoint the USER moved reopens a resting cycle.
   * Without it a new comfort request can sit behind the sensor-settling gate,
   * which reads as a dead control. Auto only ever writes back the target it read,
   * so it cannot trip this itself.
   */
  lastTargetTemperature: number | null;
  /**
   * When Auto first started trying to run without a usable sensor reading.
   * Null once a usable reading arrives or the fail-safe fires. Used to bound
   * AIRCON_AUTO_SENSOR_GRACE_MS — see its comment above.
   */
  sensorPendingSinceAt: number | null;
  /**
   * A change the OWNER made that has not been acted on yet — a target they
   * moved, or a fresh press of Auto. Null means nothing is outstanding.
   *
   * This is a latch, deliberately, and that is the whole fix of 2026-09-05.
   * The intent used to be inferred per tick from lastTargetTemperature, but
   * every return path — including the refusals — adopted the new target, so a
   * request that arrived while the compressor dwell was still running was
   * erased five seconds later by the tick that refused it. The unit then sat
   * off waiting for a settled sensor while the room drifted. A guard may defer
   * a person's request; it may not consume it.
   *
   * See specs/aircon-auto-control.md §4 for what sets and clears it.
   */
  userRequestAt: number | null;
};

/**
 * Why the planner did what it did. Purely for the monitoring stream, and the
 * reason the 2026-08-09 flip-flop had to be reconstructed from Home Assistant's
 * own history: the telemetry recorded which services were sent but never which
 * direction was wanted, so a reversal was invisible in it.
 */
export type AirconAutoReason =
  | "no-entity"
  | "no-target"
  | "sensor-fail-safe-off"
  | "sensor-pending"
  | "driving"
  | "reached-target"
  | "resting"
  | "mode-hold"
  | "sensor-settling-hold"
  | "min-cycle-hold"
  | "unsupported-direction";

export type AirconAutoPlan = {
  actions: EntityActionInput[];
  nextState: AirconAutoState;
  reason: AirconAutoReason;
  /** The direction the planner wanted this tick, whether or not it was allowed. */
  wantedMode?: ActiveAirconMode;
};

export type AirconAutoPlanInput = {
  currentTemperature: number | null;
  entity?: DashboardEntity;
  forceRemember?: boolean;
  now?: number;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  /** Partial because it round-trips through preferences; missing keys read as "unknown". */
  state?: Partial<AirconAutoState>;
  turboSwitch?: DashboardEntity;
};
