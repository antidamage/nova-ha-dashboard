/**
 * Dashboard air-con control rules — facade. The body lives in
 * lib/aircon-control/; this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   aircon-control/types.ts         EntityActionInput, AirconAutoState and the
 *                                   plan shapes; the design notes for Auto
 *   aircon-control/constants.ts     guard sizes and their evidence, modes, fan
 *                                   steps, INITIAL_AIRCON_AUTO_STATE
 *   aircon-control/entity-model.ts  climate attribute readers, the measured
 *                                   temperature, the aircon entity selector
 *   aircon-control/mode-model.ts    mode support, displayed mode, fan steps,
 *                                   the direction a user target implies
 *   aircon-control/cycle-model.ts   cycle-state normalising and its
 *                                   preferences round trip
 *   aircon-control/action-model.ts  fan-step, drive and stop service actions
 *   aircon-control/plan-model.ts    planAirconAutoTick, the Auto loop decision
 *   aircon-control/thermostat.ts    AirconAutoThermostat, the stateful wrapper
 *
 * lib/aircon-control.test.ts stays beside this facade: it is compiled by
 * tsconfig.aircon-test.json and run by `npm run test:aircon`.
 */
export type {
  AirconAutoPlan,
  AirconAutoPlanInput,
  AirconAutoReason,
  AirconAutoState,
  EntityActionInput,
} from "./aircon-control/types";
export {
  AIRCON_AUTO_POLL_MS,
  AIRCON_FAN_STEPS,
  AIRCON_MODES,
  AIRCON_SENSOR_RESOLUTION_DEGREES,
  AIRCON_SENSOR_SETTLE_MS,
  AIRCON_SENSOR_TIME_CONSTANT_MS,
  AIRCON_USER_REQUEST_MAX_AGE_MS,
  INITIAL_AIRCON_AUTO_STATE,
} from "./aircon-control/constants";
export type { AirconFanStep, AirconMode } from "./aircon-control/constants";
export {
  airconAutoMeasuredTemperature,
  climateCurrentTemperature,
  climateTargetTemperature,
  dashboardAirconEntity,
  isClimateEntityOn,
  numericClimateAttribute,
  stringListAttribute,
} from "./aircon-control/entity-model";
export {
  airconAutoSupported,
  airconEntityMode,
  airconFanModeServiceValue,
  airconFanStep,
  airconFanStepForTemperatureDelta,
  airconModeSupported,
  airconUserModeIntent,
  displayedAirconMode,
  isAirconMode,
} from "./aircon-control/mode-model";
export {
  airconAutoCycleRemember,
  airconAutoCycleStateFromPreferences,
  createInitialAirconAutoState,
} from "./aircon-control/cycle-model";
export { airconFanStepActions } from "./aircon-control/action-model";
export { buildAirconAutoActions, planAirconAutoTick } from "./aircon-control/plan-model";
export { AirconAutoThermostat } from "./aircon-control/thermostat";
