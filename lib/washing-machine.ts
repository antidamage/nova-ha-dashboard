/**
 * Washing-machine cycles, detected from a metering plug.
 *
 * A wash is a shape in the power trace, not an event the machine reports: it
 * rises, runs with pauses for soaking and draining, and then stops. This module
 * turns that shape into discrete cycles a person can be attributed to. See
 * specs/power-meters.md §4.
 *
 * It is deliberately pure — the caller owns the clock, the rate and the file —
 * so every boundary can be tested without a timer or a disk.
 */

/*
 * Facade. The body lives in lib/washing-machine/; this file keeps the import
 * path stable for its callers (specs/agent-token-footprint.md §3.3).
 *
 *   washing-machine/types.ts              cycle, open-cycle, state, totals shapes
 *   washing-machine/cycle-model.ts        recordWashingMachineSample: detection,
 *                                         integration, completion capture
 *   washing-machine/attribution-model.ts  pattern rules that guess a wash's person
 *   washing-machine/totals-model.ts       sparkline, pruning, month totals, person cycling
 */
export type {
  AutoAttributionConfig,
  WashAttribution,
  WashCompletion,
  WashingMachineCycle,
  WashingMachineOpenCycle,
  WashingMachineState,
  WashingMachineTotals,
  WashRule,
} from "./washing-machine/types";
export {
  blankWashingMachineState,
  cycleId,
  recordWashingMachineSample,
  WASHING_MACHINE_HISTORY_DAYS,
} from "./washing-machine/cycle-model";
export { autoAttributeCycle, settleAutoAttribution } from "./washing-machine/attribution-model";
export {
  cyclesInMonth,
  downsampleTrace,
  monthTotals,
  nextPerson,
  pruneWashingMachineCycles,
} from "./washing-machine/totals-model";
