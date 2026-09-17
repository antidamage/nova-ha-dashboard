import type { BedroomHeaterAutoState } from "./types";

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
 * cannot retry without a later user action.
 */
export const BEDROOM_HEATER_SENSOR_GRACE_MS = 2 * 60_000;
export const BEDROOM_HEATER_DEFAULT_TARGET_C = 18;
export const BEDROOM_HEATER_MIN_TARGET_C = 5;
export const BEDROOM_HEATER_MAX_TARGET_C = 30;

export const INITIAL_BEDROOM_HEATER_AUTO_STATE: BedroomHeaterAutoState = {
  lastTransitionAt: null,
  enteredBandAt: null,
  tailedOff: false,
  lastTargetTemperature: null,
  sensorPendingSinceAt: null,
};
