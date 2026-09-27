// The wash graph's day blocks in the household's own timezone: the day an
// instant falls in, the days that hold a wash, and one day's washes with the
// labels and curve each is drawn with. See specs/power-meters.md 5.2.
import { readDashboardConfigSync } from "../dashboard-config";
import { blankWashingMachineState, cycleId, downsampleTrace, type WashingMachineCycle, type WashingMachineState } from "../washing-machine";
import {
  blockStartWallMs,
  blockStartsForSpan,
  wallClockLabel,
  washDurationLabel,
  WASH_BLOCK_MS,
} from "../washing-machine/history-model";
import { localInstantMs, localParts, localWallMs, monthNames } from "./calendar";
import { readJson, WASHING_MACHINE_PATH, powerConfig } from "./store";
import { currentRate } from "./tariff";
import type { WashBlock, WashGraphCycle, WashHistory, WashMonthRate } from "./types";
import { buildWashDetail } from "./wash-detail";
import { washTemperature } from "./wash-temperature";
import { openPoints, readWashTemperatures, tracePoints } from "./wash-traces";
import { buildWashMonth, cyclePlaceholder, washMonthOnShow } from "./wash-months";
import { washRates } from "./washing-rates";

/** The local day an instant falls in, labelled in the household's timezone. */
export function washBlockOf(atMs: number): WashBlock {
  const startWall = blockStartWallMs(localWallMs(new Date(atMs)));
  const parts = localParts(new Date(localInstantMs(startWall)));
  return {
    dateLabel: `${parts.weekday} ${Number(parts.day)} ${monthNames[parts.month - 1]} ${parts.year}`,
    endMs: localInstantMs(startWall + WASH_BLOCK_MS),
    startMs: localInstantMs(startWall),
  };
}

/**
 * Every local day holding a wash, oldest first — the graph's step list, so the
 * buttons skip the days with no data in them. A wash counts in every day it runs
 * across, which is why one that starts at 11:50 PM shows in both.
 */
export function washBlockStarts(state: WashingMachineState, now: Date) {
  const starts = new Set<number>();
  const add = (fromIso: string, toIso: string) => {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    for (const wall of blockStartsForSpan(localWallMs(new Date(from)), localWallMs(new Date(to)))) {
      starts.add(localInstantMs(wall));
    }
  };
  for (const cycle of state.cycles) add(cycle.startedAt, cycle.endedAt);
  // The wash under way is data too, and it is the graph's newest block.
  if (state.open?.startedAt) add(state.open.startedAt, now.toISOString());
  return [...starts].sort((a, b) => a - b);
}

/**
 * A wash's own watts, from its trace file, or the open trace while it runs:
 * downsampled to the 48 points a block on the panel's card is drawn from (§5.2),
 * through the same readers the laundry page's sheets use for the same files.
 */
async function readCurve(cycle: WashGraphCycle) {
  return downsampleTrace(cycle.active ? await openPoints(cycle.startedAt) : await tracePoints(cycle.id));
}

/**
 * The labels drawn under one wash's block: when it started locally, and how long
 * it ran. Its own instants, not the block's, so a wash that runs over midnight
 * reads the same in both days.
 */
function washLabels(cycle: WashGraphCycle) {
  const from = Date.parse(cycle.startedAt);
  const to = Date.parse(cycle.endedAt);
  return {
    durationLabel: washDurationLabel(to - from),
    startLabel: wallClockLabel(localWallMs(new Date(from))),
  };
}

/** The washes of one day: every closed cycle it touches, plus the open one. */
async function readWashBlock(state: WashingMachineState, block: WashBlock, now: Date) {
  const touches = (from: number, to: number) => from < block.endMs && to > block.startMs;
  const cycles: WashGraphCycle[] = state.cycles.filter((cycle) =>
    touches(Date.parse(cycle.startedAt), Date.parse(cycle.endedAt)),
  );
  const open = state.open;
  if (open?.startedAt && touches(Date.parse(open.startedAt), now.getTime())) {
    cycles.push({
      active: true,
      ...(open.attribution ? { attribution: open.attribution } : {}),
      costNzd: open.costNzd,
      endedAt: now.toISOString(),
      id: cycleId(open.startedAt),
      kwh: open.kwh,
      person: open.person ?? null,
      startedAt: open.startedAt,
    });
  }
  const ordered = cycles.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  return Promise.all(
    ordered.map(async (cycle) => ({ ...cycle, ...washLabels(cycle), curve: await readCurve(cycle) })),
  );
}

/**
 * One day of the graph, with the index to step through.
 *
 * `atMs` names the day to read; without it the newest day holding a wash is
 * read, which is what the graph shows until it is stepped back. With no washes at
 * all that is the day holding now, so the graph still labels itself.
 */
export async function buildWashHistory(
  state: WashingMachineState,
  atMs: number | null,
  now: Date,
): Promise<WashHistory> {
  const blocks = washBlockStarts(state, now);
  const window = washBlockOf(atMs ?? blocks.at(-1) ?? now.getTime());
  return { blocks, cycles: await readWashBlock(state, window, now), window };
}

/**
 * One calendar month of the machine's history, for the standalone laundry page:
 * the washes in it, what they cost, the months either side, and the plan they
 * were costed at (`specs/power-meters.md` §5.3).
 *
 * Null when no washing machine is configured, so the page says so rather than
 * rendering an empty bill for a household that has none.
 */
export async function readWashMonth(requested: string | null) {
  const config = powerConfig().washingMachine;
  if (!config) {
    return null;
  }
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  const now = new Date();
  const state = { ...blankWashingMachineState(), ...persisted };
  // Which month is on show has to be settled first: it is that month's washes whose
  // traces are read for their temperatures (§5.3).
  const monthKey = washMonthOnShow(state, requested, now);
  return buildWashMonth({
    state,
    requested,
    now,
    people: readDashboardConfigSync().dashboard.people ?? [],
    rate: washMonthRate(now),
    temperatures: await readWashTemperatures(state, monthKey, config),
  });
}

/**
 * The plan a wash is costed at: the machine's own when it has one, the
 * household's otherwise — the same answer the tick's costing reached at the time
 * (§4.1). One function, because the month the page pages through and one wash's
 * own sheet must not state different rates for the same wash.
 */
function washMonthRate(now: Date): WashMonthRate {
  const rates = washRates();
  if (rates) {
    return {
      asOf: rates.asOf ?? null,
      cPerKwh: rates.cPerKwh,
      includingGst: true,
      planName: rates.planName,
      sourceUrl: rates.sourceUrl ?? "",
      windows: rates.windows,
    };
  }
  const household = currentRate(now);
  return {
    asOf: null,
    cPerKwh: household.cPerKwh,
    includingGst: false,
    planName: household.displayName,
    sourceUrl: household.sourceUrl,
    windows: [],
  };
}

/**
 * One wash, for the laundry page's detail sheet: the cycle, its own samples at
 * the resolution the meter kept them, and the plan it was costed at (§5.3).
 *
 * Null when no washing machine is configured, when the id names no wash the store
 * still holds, and for the open wash when none is running — the page says so
 * rather than rendering an empty sheet for a URL somebody typed by hand.
 */
export async function readWashDetail(id: string) {
  const config = powerConfig().washingMachine;
  if (!config) {
    return null;
  }
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  const state = { ...blankWashingMachineState(), ...persisted };
  const open = state.open?.startedAt ? state.open : null;
  // The wash under way has no stored id: every view names it with the
  // placeholder, and its own start instant is the id its trace would carry, so
  // either answers for it (§4.6).
  const running = open !== null && (id === cyclePlaceholder || id === cycleId(open.startedAt!));
  const cycle: WashingMachineCycle | null = running && open
    ? {
        costNzd: open.costNzd,
        endedAt: new Date().toISOString(),
        id: cyclePlaceholder,
        kwh: open.kwh,
        person: open.person ?? null,
        startedAt: open.startedAt!,
      }
    : state.cycles.find((candidate) => candidate.id === id) ?? null;
  if (!cycle) {
    return null;
  }
  const points = running ? await openPoints(cycle.startedAt) : await tracePoints(cycle.id);
  return buildWashDetail({
    cycle,
    people: readDashboardConfigSync().dashboard.people ?? [],
    points,
    rate: washMonthRate(new Date()),
    running,
    // A wash still running has not finished heating: its temperature is named only
    // once the element's own run is over in the trace (§5.3).
    temperature: washTemperature(points, config.temperature, {
      complete: !running,
      maxGapSeconds: config.timer.maxSampleGapSeconds,
    }),
  });
}
