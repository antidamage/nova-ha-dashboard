// Facade: the floating meter's model lives in lib/power/floating-meter.ts.
// Kept at this path so its existing importers do not change
// (specs/agent-token-footprint.md §3.3).
export type {
  FloatingMeterCategoryReading,
  FloatingMeterCategoryState,
  FloatingMeterConfidence,
  FloatingMeterHourBucket,
  FloatingMeterState,
} from "./power/floating-meter";
export {
  blankCategoryState,
  blankFloatingMeterState,
  categoryReading,
  FLOATING_METER_HISTORY_DAYS,
  floatingMeterReadings,
  pruneFloatingMeterState,
  recordFloatingSample,
  suppressedBaseLoadIds,
} from "./power/floating-meter";
