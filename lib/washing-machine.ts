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
 *   washing-machine/timer-model.ts        the wash's timer: periods, extensions,
 *                                         the stop that finishes it
 *   washing-machine/totals-model.ts       sparkline, pruning, month totals, person cycling
 */
export type {
  WashAttribution,
  WashCompletion,
  WashingMachineCycle,
  WashingMachineOpenCycle,
  WashingMachineState,
  WashingMachineTotals,
  WashTimer,
  WashTimerConfig,
} from "./washing-machine/types";
export {
  blankWashingMachineState,
  cycleId,
  recordWashingMachineSample,
  WASHING_MACHINE_HISTORY_DAYS,
} from "./washing-machine/cycle-model";
export { advanceWashTimer, beginWashTimer, completeWashTimer } from "./washing-machine/timer-model";
export {
  cyclesInMonth,
  downsampleTrace,
  monthTotals,
  nextPerson,
  pruneWashingMachineCycles,
} from "./washing-machine/totals-model";
