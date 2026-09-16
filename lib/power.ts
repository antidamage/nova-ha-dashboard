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
 *   power/washing.ts          washing-machine tick, attribution, summary
 *   power/dashboard.ts        buildDashboard
 *   power/ha-publish.ts       MQTT discovery and state publishing
 *   power/meter-sampling.ts   the metering plugs' tick
 *   power/sampling.ts         the power sample and the monitor's timers
 *   power/history-repair.ts   floating-meter reattribution, wash rebuild
 */
export type {
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
} from "./power/types";
export { setFloatingMeterCategory } from "./power/meters";
export { attributeOpenWashingMachineCycle, attributeWashingMachineCycle } from "./power/washing";
export { reattributeFloatingMeterHistory, rebuildWashingMachineHistory } from "./power/history-repair";
export { ensurePowerMonitorStarted, sampleMetersNow, samplePowerNow } from "./power/sampling";
