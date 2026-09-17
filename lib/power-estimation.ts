/**
 * Powershop usage estimates — facade. The body lives in lib/power-estimation/;
 * this file keeps the import path stable for its callers
 * (specs/agent-token-footprint.md §3.3).
 *
 *   power-estimation/types.ts              estimate result and calibration shapes
 *   power-estimation/weights-model.ts      half-life, date helpers, recency and
 *                                          similarity weights, weighted mean
 *   power-estimation/calibration-model.ts  hourly profile, day/week/month
 *                                          projection, calibratePowershopEstimates
 */
export type { PowershopEstimateCalibration, PowershopEstimateResult } from "./power-estimation/types";
export { POWERSHOP_ESTIMATE_HALF_LIFE_DAYS, recencyWeight, similarityWeight } from "./power-estimation/weights-model";
export { calibratePowershopEstimates } from "./power-estimation/calibration-model";
