/**
 * Power monitoring — facade. The body lives in lib/power/; this file keeps the
 * import path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 * Where things are:
 *
 *   power/types.ts            dashboard payload and persisted-state shapes
 *   power/store.ts            SOLE owner of globalThis, module-level and disk
 *                             state: data paths, powerConfig, the runtime and
 *                             write queue, JSON persistence, wash-curve cache
 *   power/numbers.ts          round, slug
 *   power/calendar.ts         local-time keys, billing cycle, currentKeys
 *   power/tariff.ts           configured plan, current rate, rate-source watch
 *   power/device-estimate.ts  per-device wattage from HA state and ratings
 *   power/base-load.ts        the modelled always-on loads
 *   power/aggregate.ts        buckets, projections, graphs, pruneState
 *   power/floating-meter.ts   the floating meter's pure model
 *   power/meters.ts           plug readings; floating-meter tick and summary
 *   power/washing.ts          washing-machine tick, month summary, day read
 *   power/wash-claim.ts       who a wash belongs to: the tap and the picker
 *   power/wash-history.ts     the wash graph's day blocks, and the month read
 *   power/wash-months.ts      the laundry page's month view
 *   power/washing-rates.ts    the plan the machine is costed at
 *   power/dashboard.ts        buildDashboard
 *   power/ha-publish.ts       MQTT discovery and state publishing
 *   power/meter-sampling.ts   the metering plugs' tick
 *   power/sampling.ts         the power sample and the monitor's timers
 *   power/history-repair.ts   floating-meter reattribution, wash rebuild
 */
export type {
  AmpControlSummary,
  AmpSwitches,
  PowerAccountUsagePoint,
  PowerBackgroundEstimatePoint,
  PowerBaseLoadSummary,
  PowerDashboard,
  PowerDeviceRating,
  PowerDeviceReading,
  PowerFloatingMeterSummary,
  PowerModeledLoad,
  PowerPeriodSummary,
  PowerPoint,
  PowerRatePoint,
  PowerWashingMachineSummary,
  WashBlock,
  WashGraphCycle,
  WashHistory,
  WashMonthCycle,
  WashMonthRate,
  WashMonthView,
} from "./power/types";
export {
  readActiveFloatingCategoryId,
  readAmpAutomation,
  setAmpAutomation,
  setFloatingMeterCategory,
} from "./power/meters";
export {
  attributeOpenWashingMachineCycle,
  attributeWashingMachineCycle,
  setWashingMachineCyclePerson,
} from "./power/wash-claim";
export { readWashHistory } from "./power/washing";
export { readWashMonth } from "./power/wash-history";
export { washRateAt, washRates } from "./power/washing-rates";
export { reattributeFloatingMeterHistory, rebuildWashingMachineHistory } from "./power/history-repair";
export { ensurePowerMonitorStarted, sampleMetersNow, samplePowerNow } from "./power/sampling";
