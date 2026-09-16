import type { AirconAutoState } from "./types";

export const AIRCON_AUTO_POLL_MS = 1_000;

/*
 * Guard sizes. These are set against the SENSOR, not against comfort.
 *
 * Auto measures the Gree's own return-air thermistor (see
 * airconAutoMeasuredTemperature), which sits downstream of the compressor it is
 * controlling. On 2026-08-09 that produced 7 compressor starts and 4 heat<->cool
 * reversals in 45 minutes, in the middle of winter: the unit reached target 22,
 * switched off, the fan stopped, the thermistor heat-soaked 22 -> 23 in ONE
 * SECOND, and the old +-1 C band read that as "the room is a degree too warm,
 * cool it". While cooling it then reported 23 -> 25 in two minutes, which no
 * room does. Every number below is chosen so that transient cannot reach the
 * actuator.
 */

/**
 * A reversal still needs this much evidence after the sensor has settled. The
 * reading swings 2-3 C on compressor transitions, so a smaller cross-direction
 * threshold could turn residual heat/cold around the indoor unit into a reversal.
 *
 * A target the USER moved bypasses this (see reopened, below) — the threshold
 * exists to ignore a drifting sensor, never to ignore a person.
 */
export const AIRCON_AUTO_DIRECTION_CHANGE_DEGREES = 3;
/** The Gree reports whole degrees, so this is the smallest observable drift. */
export const AIRCON_AUTO_SAME_DIRECTION_RESUME_DEGREES = 1;
/** Gree current_temperature is quantised to whole degrees. */
export const AIRCON_SENSOR_RESOLUTION_DEGREES = 1;
/**
 * Conservative fallback for an off Gree sensor whose transient is ambiguous.
 *
 * Nova's 2026-08-11 HA history has the reading continue moving for 14-21
 * minutes after heat stops. Laboratory work on common enclosed HVAC room
 * sensors measured low-airflow cooling time constants around 9-11 minutes
 * (Hayashi et al., 2002, DOI 10.18948/shase.27.84_31); a first-order thermal
 * sensor is about 95% settled after three time constants. Thirty minutes is
 * therefore a conservative, evidence-based fallback for this unforced indoor
 * unit. A consistent same-direction trace may act earlier using the time
 * constant below, but never before the compressor dwell.
 *
 * This is intentionally asymmetric. A running sensor reaching target may stop
 * the unit immediately: a possibly early stop is safe, while a possibly early
 * start is the transition that caused the observed flip-flopping.
 */
export const AIRCON_SENSOR_SETTLE_MS = 30 * 60_000;
/**
 * First-order time constant used to extrapolate the post-stop equilibrium.
 * Published low-airflow means are about 9-11 minutes. This Gree's recent first
 * and second whole-degree corrections had medians of about 6.5 and 15.5
 * minutes, respectively, so 10 minutes is also centred on the local evidence.
 */
export const AIRCON_SENSOR_TIME_CONSTANT_MS = 10 * 60_000;
/** Flip-flop guard: having chosen a direction, hold it this long. */
export const AIRCON_AUTO_MODE_HOLD_MS = 30 * 60_000;
/** Dwell before STARTING the compressor again, matching BEDROOM_HEATER_MIN_CYCLE_MS. */
export const AIRCON_AUTO_MIN_CYCLE_MS = 10 * 60_000;
/** Retain one hour of start telemetry; it is not a start limit. */
export const AIRCON_AUTO_STARTS_WINDOW_MS = 60 * 60_000;
/**
 * How long Auto is allowed to run with NO usable room-temperature reading
 * before it fails safe.
 *
 * The Gree's own thermistor (see airconAutoMeasuredTemperature) only pushes
 * fresh readings while the unit is actively running — while off, Home
 * Assistant reports the attribute stale or unavailable. Failing safe the
 * instant the reading is missing therefore deadlocks Auto: it can never turn
 * itself on, because turning on is the only thing that produces a reading.
 * This grace window lets Auto attempt to run first; only if the sensor is
 * STILL unusable after it does the unit switch off. The unified controller
 * then clears Auto, preventing an unattended retry until a later user action.
 */
export const AIRCON_AUTO_SENSOR_GRACE_MS = 2 * 60_000;

/**
 * How long an unserved owner request stays latched.
 *
 * Everything that can defer a request is measured in minutes, so half an hour
 * unserved means it could not be served at all — the entity was unavailable, or
 * someone took the unit over from the panel. Firing it later would act on a room
 * that has since moved on, which is its own kind of surprise.
 */
export const AIRCON_USER_REQUEST_MAX_AGE_MS = 30 * 60_000;

export const AIRCON_MODES = ["heat", "cool", "dry", "fan_only", "auto"] as const;
export const AIRCON_FAN_STEPS = ["quiet", "low", "medium low", "medium", "medium high", "high", "turbo"] as const;

export type AirconMode = (typeof AIRCON_MODES)[number];
export type AirconFanStep = (typeof AIRCON_FAN_STEPS)[number];

export const INITIAL_AIRCON_AUTO_STATE: AirconAutoState = {
  lastMode: null,
  lastModeAt: null,
  lastTransitionAt: null,
  settlingFromTemperature: null,
  recentStartsAt: [],
  lastTargetTemperature: null,
  sensorPendingSinceAt: null,
  userRequestAt: null,
};
