// The washing machine's months: the month view the laundry page pages through.
//
// A calendar month in the household's own timezone — 1st to end of month, the
// same month the panel's sub-totals use (§4.4) — because this is a bill-shaped
// read of the machine's own history rather than a rolling window. The page can
// step back through every month the store still holds (400 days).
//
// Pure: the store, the clock and the household's people are all arguments, so a
// month can be built from a fixture. See specs/power-meters.md §5.3.
import type { HouseholdPerson } from "../config-schema";
import {
  cyclesInMonth,
  monthTotals,
  type WashingMachineCycle,
  type WashingMachineState,
} from "../washing-machine";
import { wallClockLabel, washDurationLabel } from "../washing-machine/history-model";
import { localMonthKey, localParts, localWallMs, monthNames } from "./calendar";
import type { WashMonthCycle, WashMonthRate, WashMonthView } from "./types";

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2026-09` as a bill heads it: `September 2026`. */
export function washMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const name = FULL_MONTHS[month - 1];
  return name && Number.isFinite(year) ? `${name} ${year}` : monthKey;
}

/** The month a wash's instant falls in, in the household's timezone. */
function monthOf(iso: string | null | undefined) {
  return iso ? localMonthKey(new Date(iso)) : null;
}

/**
 * Every calendar month holding a wash, newest first — the page's own step list,
 * so its arrows skip the months with nothing in them. A wash counts in the month
 * it ended, the same bucket the totals use.
 *
 * The month under way is prepended when it holds no wash yet: an empty month is a
 * real answer for "what has the machine used", and the page must be able to say
 * `$0.00` rather than nothing. It is NOT prepended when it does hold one, so the
 * list's first entry is always a month worth opening on.
 */
export function washMonths(state: WashingMachineState, now: Date) {
  const keys = new Set<string>();
  for (const cycle of state.cycles) {
    const key = monthOf(cycle.endedAt);
    if (key) keys.add(key);
  }
  const openMonth = monthOf(state.open?.startedAt);
  if (openMonth) keys.add(openMonth);
  const current = localMonthKey(now);
  const withWashes = [...keys].sort((a, b) => b.localeCompare(a));
  return withWashes.includes(current) ? withWashes : [current, ...withWashes];
}

/** A wash as the page lists it: its local date, start time and length. */
function monthCycle(cycle: WashingMachineCycle): WashMonthCycle {
  const from = Date.parse(cycle.startedAt);
  const parts = localParts(new Date(from));
  return {
    ...cycle,
    dateLabel: `${parts.weekday} ${Number(parts.day)} ${monthNames[parts.month - 1]}`,
    durationLabel: washDurationLabel(Date.parse(cycle.endedAt) - from),
    startLabel: wallClockLabel(localWallMs(new Date(from))),
  };
}

/**
 * One month of the machine's history, and the months either side so the page can
 * be paged.
 *
 * `requested` asks for a month by key; an unknown or absent one opens the page on
 * the step list's first entry, which is the month under way when it holds a wash
 * and an empty month under way when it does not — a bill opens on the current
 * period, and "nothing used yet" is the answer to the question this page asks.
 * The wash under way is reported separately and counted in nothing: it is
 * nobody's until it closes (§4.3).
 */
export function buildWashMonth(options: {
  state: WashingMachineState;
  requested: string | null;
  now: Date;
  people: HouseholdPerson[];
  rate: WashMonthRate;
}): WashMonthView {
  const { state, now, people, rate } = options;
  const months = washMonths(state, now);
  const monthKey = options.requested && months.includes(options.requested) ? options.requested : months[0];
  const cycles = cyclesInMonth(state.cycles, monthKey, (iso) => localMonthKey(new Date(iso)))
    .map(monthCycle);
  const index = months.indexOf(monthKey);
  const open = state.open?.startedAt ? state.open : null;
  return {
    monthKey,
    label: washMonthLabel(monthKey),
    months,
    nextMonthKey: index > 0 ? months[index - 1] : null,
    previousMonthKey: months[index + 1] ?? null,
    cycles,
    running: open && monthOf(open.startedAt) === monthKey
      ? monthCycle({
          costNzd: open.costNzd,
          endedAt: now.toISOString(),
          id: cyclePlaceholder,
          kwh: open.kwh,
          person: open.person ?? null,
          startedAt: open.startedAt!,
        })
      : null,
    totals: monthTotals(cycles, people.map((person) => person.id)),
    people,
    // The month's own count, from the list the rows and the figures come from.
    // NOT `totals`' `null` row, which is the Unassigned *bucket*: the totals
    // table renders that one separately, and reading it as the grand total put
    // the unassigned count on the "All washes" line of a printed bill.
    washes: cycles.length,
    kwh: cycles.reduce((sum, cycle) => sum + cycle.kwh, 0),
    costNzd: cycles.reduce((sum, cycle) => sum + cycle.costNzd, 0),
    rate,
  };
}

/**
 * The running wash's id in this view. It has no stored id yet — the store names a
 * cycle when it closes — and the page claims it through the open wash's own
 * route rather than by id, so a value no cycle can collide with is all it needs.
 */
export const cyclePlaceholder = "running";
