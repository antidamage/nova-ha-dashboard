// The wash graph's 12-hour blocks in the household's own timezone: the block an
// instant falls in, the blocks that hold a wash, and one block's washes with the
// curve each is drawn from. See specs/power-meters.md 5.2.
import path from "path";
import { cycleId, downsampleTrace, type WashingMachineState } from "../washing-machine";
import { blockStartWallMs, blockStartsForSpan, WASH_BLOCK_MS } from "../washing-machine/history-model";
import { localInstantMs, localParts, localWallMs, monthNames } from "./calendar";
import { readJson, WASH_TRACE_DIR } from "./store";
import type { OpenWashTrace, WashBlock, WashGraphCycle, WashHistory, WashTraceFile } from "./types";

const OPEN_TRACE_PATH = path.join(WASH_TRACE_DIR, "open.json");

function clockLabel(hour24: number) {
  const hour = ((hour24 % 24) + 24) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/** The 12-hour block an instant falls in, labelled in the household's timezone. */
export function washBlockOf(atMs: number): WashBlock {
  const startWall = blockStartWallMs(localWallMs(new Date(atMs)));
  const startMs = localInstantMs(startWall);
  const parts = localParts(new Date(startMs));
  return {
    dateLabel: `${parts.weekday} ${Number(parts.day)} ${monthNames[parts.month - 1]} ${parts.year}`,
    endLabel: clockLabel(startWall / 3_600_000 + 12),
    endMs: localInstantMs(startWall + WASH_BLOCK_MS),
    startLabel: clockLabel(startWall / 3_600_000),
    startMs,
  };
}

/**
 * Every 12-hour block holding a wash, oldest first — the graph's step list, so
 * the buttons skip the blocks with no data in them. A wash counts in every block
 * it runs across, which is why one that starts at 11:50 shows in both.
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

/** The washes of one block: every closed cycle it touches, plus the open one. */
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
    ordered.map(async (cycle) => ({ ...cycle, curve: await readCurve(cycle) })),
  );
}

/**
 * One block of the graph, with the index to step through.
 *
 * `atMs` names the block to read; without it the newest block holding a wash is
 * read, which is what the graph shows until it is stepped back. With no washes at
 * all that is the block holding now, so the graph still labels itself.
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
