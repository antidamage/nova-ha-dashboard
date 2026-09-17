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
 * There is no clock schedule. An auto-on/auto-off window existed until
 * 2026-08-19 and was removed at the owner's request: the heater must never
 * start or stop itself because a time of day arrived. The only things that
 * change its mode are a user action and the sleep timer a user sets, and the
 * only thing that switches the relay under Auto is the room temperature
 * against the target.
 */

/**
 * Bedroom heater control — facade. The body lives in
 * lib/bedroom-heater-control/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3).
 *
 *   bedroom-heater-control/types.ts         action, auto-state and plan shapes
 *   bedroom-heater-control/constants.ts     poll/band/dwell/grace/target limits,
 *                                           initial auto state
 *   bedroom-heater-control/inputs-model.ts  room-sensor trust and freshness,
 *                                           mode/target/sleep-timer readers
 *   bedroom-heater-control/thermostat.ts    planBedroomHeaterTick and the
 *                                           BedroomHeaterThermostat wrapper
 */
export type {
  BedroomHeaterAction,
  BedroomHeaterAutoState,
  BedroomHeaterPlan,
  BedroomHeaterPlanInput,
} from "./bedroom-heater-control/types";
export {
  BEDROOM_HEATER_AUTO_POLL_MS,
  BEDROOM_HEATER_BAND_DEGREES,
  BEDROOM_HEATER_DEFAULT_TARGET_C,
  BEDROOM_HEATER_MAX_TARGET_C,
  BEDROOM_HEATER_MIN_CYCLE_MS,
  BEDROOM_HEATER_MIN_TARGET_C,
  BEDROOM_HEATER_SENSOR_GRACE_MS,
  BEDROOM_HEATER_TAIL_OFF_MS,
  INITIAL_BEDROOM_HEATER_AUTO_STATE,
} from "./bedroom-heater-control/constants";
export {
  bedroomHeaterMode,
  bedroomHeaterSleepTimerEndsAt,
  bedroomHeaterSleepTimerExpired,
  bedroomHeaterTargetTemperature,
  bedroomTemperatureStateIsFresh,
  bedroomTemperatureStateIsUsable,
  clampTargetTemperature,
  createInitialBedroomHeaterAutoState,
  roomTemperatureEntityIds,
} from "./bedroom-heater-control/inputs-model";
export { BedroomHeaterThermostat, planBedroomHeaterTick } from "./bedroom-heater-control/thermostat";
