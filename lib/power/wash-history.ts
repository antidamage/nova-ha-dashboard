// The wash graph's day blocks in the household's own timezone: the day an
// instant falls in, the days that hold a wash, and one day's washes with the
// labels and curve each is drawn with. See specs/power-meters.md 5.2.
import path from "path";
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
import { readJson, WASH_TRACE_DIR, WASHING_MACHINE_PATH, powerConfig } from "./store";
import { currentRate } from "./tariff";
import type { OpenWashTrace, WashBlock, WashGraphCycle, WashHistory, WashMonthRate, WashTraceFile } from "./types";
import { buildWashDetail, type WashDetailSample } from "./wash-detail";
import { buildWashMonth, cyclePlaceholder } from "./wash-months";
import { washRates } from "./washing-rates";

const OPEN_TRACE_PATH = path.join(WASH_TRACE_DIR, "open.json");

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

/** A wash's own watts, from its trace file, or the open trace while it runs. */
async function readCurve(cycle: WashGraphCycle) {
  if (cycle.active) {
    const open = await readJson<OpenWashTrace | null>(OPEN_TRACE_PATH, null);
    return downsampleTrace(open && open.anchor === cycle.startedAt ? open.points : []);
  }
  const trace = await readJson<WashTraceFile | null>(path.join(WASH_TRACE_DIR, `${cycle.id}.json`), null);
  return downsampleTrace(trace?.points ?? []);
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
  if (!powerConfig().washingMachine) {
    return null;
  }
  const persisted = await readJson<WashingMachineState>(WASHING_MACHINE_PATH, blankWashingMachineState());
  const now = new Date();
  return buildWashMonth({
    state: { ...blankWashingMachineState(), ...persisted },
    requested,
    now,
    people: readDashboardConfigSync().dashboard.people ?? [],
    rate: washMonthRate(now),
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

/** A closed wash's own samples, in the shape its trace file keeps (§4.6). */
async function tracePoints(id: string): Promise<WashDetailSample[]> {
  const trace = await readJson<WashTraceFile | null>(path.join(WASH_TRACE_DIR, `${id}.json`), null);
  return trace?.points ?? [];
}

/** The open wash's samples, rebased onto the instant it started. */
function openPoints(trace: OpenWashTrace | null, startedAt: string): WashDetailSample[] {
  if (!trace || trace.anchor !== startedAt) {
    return [];
  }
  const start = Date.parse(startedAt) / 1000;
  return trace.points.map(([at, value]): WashDetailSample => [Math.round(at - start), value]);
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
  if (!powerConfig().washingMachine) {
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
  return buildWashDetail({
    cycle,
    people: readDashboardConfigSync().dashboard.people ?? [],
    points: running ? openPoints(await readJson<OpenWashTrace | null>(OPEN_TRACE_PATH, null), cycle.startedAt) : await tracePoints(cycle.id),
    rate: washMonthRate(new Date()),
    running,
  });
}
