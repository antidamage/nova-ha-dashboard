import type { WashingMachineConfig } from "../config-schema";
import { autoAttributeCycle, settleAutoAttribution } from "./attribution-model";
import type { WashingMachineCycle, WashingMachineOpenCycle, WashingMachineState } from "./types";

/** Cycles older than this are dropped — a year plus change for comparison. */
export const WASHING_MACHINE_HISTORY_DAYS = 400;

export function blankWashingMachineState(): WashingMachineState {
  return { cycles: [], open: null, version: 1 };
}

function seconds(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

export function cycleId(startedAt: string) {
  return `${startedAt.replace(/[:.]/g, "-")}`;
}

/**
 * Fold one power sample into the cycle state.
 *
 * `elapsedHours` is how long the previous reading stood for; the caller applies
 * the same `maxIntegrationHours` gap guard the rest of the power integrator
 * uses, and passes 0 when the gap is too large to trust.
 */
export function recordWashingMachineSample(
  state: WashingMachineState,
  options: {
    at: string;
    config: WashingMachineConfig;
    costPerKwh: number;
    elapsedHours: number;
    watts: number;
    /** HA report time; repeated reads of the same cached report cannot advance the quiet timer. */
    reportedAt?: string;
    /**
     * Energy since the previous sample from a kWh counter. When given it
     * replaces the held-power integral; power then only drives detection.
     */
    energyKwh?: number;
  },
): WashingMachineState {
  const { at, config, costPerKwh, elapsedHours, watts } = options;
  const open: WashingMachineOpenCycle = state.open ?? {
    aboveSince: null,
    belowSince: null,
    costNzd: 0,
    kwh: 0,
    lastSampleAt: at,
    lastWatts: watts,
    startedAt: null,
  };

  function add(kwh: number) {
    open.kwh += kwh;
    open.costNzd += kwh * costPerKwh;
  }

  // Integrate the PREVIOUS reading over the interval it actually stood for,
  // as the rest of the power integrator does. Only a running cycle
  // accumulates; standby draw between washes is not a wash.
  const counterKwh = options.energyKwh !== undefined && Number.isFinite(options.energyKwh) && options.energyKwh >= 0
    ? options.energyKwh
    : undefined;
  if (open.startedAt && counterKwh !== undefined) {
    add(counterKwh);
  } else if (open.startedAt && elapsedHours > 0) {
    add((open.lastWatts * elapsedHours) / 1000);
  } else if (!open.startedAt && counterKwh !== undefined && open.aboveSince) {
    open.preStartKwh = (open.preStartKwh ?? 0) + counterKwh;
  }
  const gap = seconds(open.lastSampleAt, at);
  const alert = config.completionAlert;
  if (alert?.enabled && (gap > alert.maxSampleGapSeconds || gap < 0)) open.belowSince = null;
  if (alert?.enabled && open.startedAt && !open.completion) {
    const reportedAt = options.reportedAt ?? at;
    const age = seconds(reportedAt, at);
    const fresh = Number.isFinite(age) && age >= -5 && age <= alert.maxSampleGapSeconds;
    if (!fresh || gap < 0 || gap > alert.maxSampleGapSeconds || elapsedHours <= 0 || watts > alert.zeroWatts) open.zeroSince = null;
    if (fresh && watts <= alert.zeroWatts) {
      open.zeroSince ??= reportedAt;
      if (open.kwh >= config.minCycleKwh && seconds(open.zeroSince, reportedAt) > alert.quietSeconds) {
        // Guess the owner before capturing the finish, so an unclaimed wash
        // that matches the pattern still gets its alert (§4.5).
        const rules = config.autoAttribution;
        if (rules?.enabled && !open.person && !open.attribution) {
          const rule = autoAttributeCycle({ endedAt: open.zeroSince, startedAt: open.startedAt }, state.cycles, rules);
          if (rule) {
            open.person = rules.personId;
            open.attribution = { at, rule, source: "auto" };
          }
        }
        // Record even an unclaimed finish: a later claim must never backfill an alert.
        open.completion = { at, person: open.person ?? null, soundFile: alert.soundFile,
          discord: alert.discord && open.person === alert.personId };
      }
    }
  }
  open.lastSampleAt = at;
  const previousWatts = open.lastWatts;
  open.lastWatts = watts;

  if (watts > config.startWatts) {
    open.belowSince = null;
    open.aboveSince ??= at;
    if (!open.startedAt && seconds(open.aboveSince, at) >= config.startSustainedSeconds) {
      // startedAt is when the rise began, not when it was confirmed, so the
      // first two minutes of a wash are not lost from its total — and neither
      // is the energy it drew over them, credited here at the rate it has been
      // running at since.
      open.startedAt = open.aboveSince;
      if (counterKwh !== undefined) {
        // This tick's delta was already folded into preStartKwh above.
        add(open.preStartKwh ?? 0);
      } else {
        add((previousWatts * seconds(open.aboveSince, at)) / 3_600_000);
      }
      delete open.preStartKwh;
    }
    return { ...state, open };
  }

  if (watts < config.endWatts) {
    open.aboveSince = null;
    if (!open.startedAt) {
      // Idle, with nothing pending. Keep no open record rather than carrying a
      // quiet-timer that describes no wash.
      return { ...state, open: null };
    }
    open.belowSince ??= at;
    if (seconds(open.belowSince, at) >= config.endQuietSeconds) {
      const closed: WashingMachineCycle = {
        ...(open.attribution ? { attribution: open.attribution } : {}),
        costNzd: Math.round(open.costNzd * 10000) / 10000,
        // endedAt is when it dropped, not when the quiet window expired.
        endedAt: open.belowSince,
        id: cycleId(open.startedAt),
        kwh: Math.round(open.kwh * 100000) / 100000,
        person: open.person ?? null,
        completion: open.completion,
        startedAt: open.startedAt,
      };
      // Below the floor this was the machine's standby panel or a door-open
      // blip, not a wash. Drop it rather than filling the month with noise.
      const cycles = closed.kwh >= config.minCycleKwh
        ? [...state.cycles, settleAutoAttribution(closed, state.cycles, config.autoAttribution, at)]
        : state.cycles;
      return { ...state, cycles, open: null };
    }
    return { ...state, open };
  }

  // In the dead band between the two thresholds — a wash idling between phases,
  // or a machine sitting with its panel lit. Neither timer advances: this is
  // neither evidence a wash has begun nor evidence one has finished.
  open.aboveSince = null;
  open.belowSince = null;
  return { ...state, open: open.startedAt ? open : null };
}
