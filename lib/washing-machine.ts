import type { WashingMachineConfig } from "./config-schema";

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

export type WashingMachineCycle = {
  completion?: WashCompletion;
  costNzd: number;
  endedAt: string;
  id: string;
  kwh: number;
  /** A configured `dashboard.people` id, or null for unassigned. */
  person: string | null;
  startedAt: string;
};

export type WashingMachineOpenCycle = {
  person?: string | null;
  zeroSince?: string | null;
  completion?: WashCompletion;
  /** When the meter first rose above the start threshold, or null. */
  aboveSince: string | null;
  /** When the meter first fell below the end threshold, or null. */
  belowSince: string | null;
  costNzd: number;
  kwh: number;
  lastSampleAt: string;
  /** The previous reading, which is what the elapsed interval actually drew. */
  lastWatts: number;
  /** Set once the rise has been sustained long enough to count as a wash. */
  startedAt: string | null;
};

export type WashingMachineState = {
  cycles: WashingMachineCycle[];
  open: WashingMachineOpenCycle | null;
  version: 1;
};

/** Cycles older than this are dropped — a year plus change for comparison. */
export const WASHING_MACHINE_HISTORY_DAYS = 400;

export function blankWashingMachineState(): WashingMachineState {
  return { cycles: [], open: null, version: 1 };
}

function seconds(from: string, to: string) {
  return (new Date(to).getTime() - new Date(from).getTime()) / 1000;
}

export type WashCompletion = { at: string; person: string | null; soundFile: string; discord: boolean; recommendation?: string };

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
  if (open.startedAt && elapsedHours > 0) {
    add((open.lastWatts * elapsedHours) / 1000);
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
      add((previousWatts * seconds(open.aboveSince, at)) / 3_600_000);
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
      const cycles = closed.kwh >= config.minCycleKwh ? [...state.cycles, closed] : state.cycles;
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

export function pruneWashingMachineCycles(state: WashingMachineState, cutoffIso: string) {
  return { ...state, cycles: state.cycles.filter((cycle) => cycle.endedAt >= cutoffIso) };
}

/**
 * The cycles that ended inside one calendar month.
 *
 * `monthKey` is `YYYY-MM` in the household's own timezone; the caller resolves
 * that, as it does for every other local-time bucket.
 */
export function cyclesInMonth(cycles: WashingMachineCycle[], monthKey: string, localMonthOf: (iso: string) => string) {
  return cycles.filter((cycle) => localMonthOf(cycle.endedAt) === monthKey);
}

export type WashingMachineTotals = {
  costNzd: number;
  cycles: number;
  kwh: number;
  person: string | null;
};

/**
 * Month totals, one row per configured person plus unassigned. People come from
 * config, so a household with none configured gets the unassigned row only —
 * which is what the panel renders as a plain total.
 */
export function monthTotals(cycles: WashingMachineCycle[], personIds: string[]): WashingMachineTotals[] {
  const rows = new Map<string | null, WashingMachineTotals>();
  for (const person of [...personIds, null]) {
    rows.set(person, { costNzd: 0, cycles: 0, kwh: 0, person });
  }
  for (const cycle of cycles) {
    // A cycle attributed to someone who has since left config counts as
    // unassigned rather than vanishing from the total.
    const key = cycle.person && rows.has(cycle.person) ? cycle.person : null;
    const row = rows.get(key)!;
    row.costNzd += cycle.costNzd;
    row.cycles += 1;
    row.kwh += cycle.kwh;
  }
  return [...rows.values()];
}

/** Unassigned -> first person -> second person -> ... -> unassigned. */
export function nextPerson(current: string | null, personIds: string[]): string | null {
  if (personIds.length === 0) {
    return null;
  }
  if (current === null) {
    return personIds[0];
  }
  const index = personIds.indexOf(current);
  if (index === -1 || index === personIds.length - 1) {
    return null;
  }
  return personIds[index + 1];
}
