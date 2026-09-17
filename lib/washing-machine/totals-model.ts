import type { WashingMachineCycle, WashingMachineState, WashingMachineTotals } from "./types";

/** Evenly spaced watts across a trace, at most `count` points, for a sparkline. */
export function downsampleTrace(points: Array<[number, number]>, count = 48): number[] {
  if (points.length <= count) return points.map(([, watts]) => watts);
  const bucket = points.length / count;
  return Array.from({ length: count }, (_, index) => {
    const slice = points.slice(Math.floor(index * bucket), Math.floor((index + 1) * bucket));
    return Math.round((slice.reduce((sum, [, watts]) => sum + watts, 0) / slice.length) * 10) / 10;
  });
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
