"use client";

// Facade: helpers shared across the dashboard cards. The body lives in ./shell/.
//   types.ts             LoungeEnvironment, BedroomHeaterDevices
//   constants.ts         special zone ids and their synthetic zones
//   format-model.ts      classNames, clamp, number/temperature/weather formatting
//   zone-model.ts        entity matching, zone classification, climate devices
//   environment-model.ts zone/lounge/bedroom environment and configured-entity lookup
export type { BedroomHeaterDevices, LoungeEnvironment } from "./shell/types";
export {
  LOUNGE_ZONE_ID,
  POWER_ZONE,
  POWER_ZONE_ID,
  STEP_EPSILON,
  TASKS_ZONE,
  TASKS_ZONE_ID,
  VOICE_ZONE,
  VOICE_ZONE_ID,
  WORLD_ZONE,
  WORLD_ZONE_ID,
} from "./shell/constants";
export {
  clamp,
  classNames,
  formatHumidity,
  formatTemperature,
  formatWeatherNumber,
  numberArray,
  roundToStep,
  temperatureDelta,
  weatherLabel,
} from "./shell/format-model";
export {
  climateDevicesForZone,
  countDomainsForZone,
  dashboardEntityIsOn,
  entityText,
  findEntityByPreferredIds,
  isBedroomZone,
  isClimateZone,
  isLoungeZone,
  isNetworkZone,
  isOutsideZone,
  isPowerZone,
  isVoiceZone,
  isWorldZone,
  matchesEntity,
  numericEntityState,
  optimisticClimateOnState,
  routerStatusLabel,
  sensorDeviceClass,
  sensorMatches,
  zoneBrightnessPctFromEntities,
} from "./shell/zone-model";
export {
  bedroomHeaterDevices,
  findBedroomTemperature,
  findConfiguredEntity,
  findLoungeEnvironment,
  findZoneEnvironment,
} from "./shell/environment-model";
