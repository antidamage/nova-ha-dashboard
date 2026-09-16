import type { WashingMachineConfig } from "./config-schema";
import type { FloatingMeterState } from "./power-floating-meter";
import {
  blankWashingMachineState,
  recordWashingMachineSample,
  type WashingMachineCycle,
  type WashingMachineState,
} from "./washing-machine";

/**
 * One-off data repair for the metering plugs (specs/power-meters.md §7.5).
 *
 * Pure: the caller owns the files, the backups, the write queue and the Home
 * Assistant fetch, so every operation here can be tested — including running it
 * twice — without a disk or a clock.
 */

/**
 * Move every hourly bucket whose hour starts before `untilMs` from one
 * category to another. A partial hour goes too: the source was not being
 * measured after `until`, so that hour's observations belong to the target.
 * Moved with its share of `kwhTotal` and `measuredSeconds`.
 * Buckets already present on the target are merged. Running it again moves
 * nothing, because the source no longer holds those buckets.
 */
export function reattributeFloatingBuckets(
  state: FloatingMeterState,
  options: {
    fromCategoryId: string;
    toCategoryId: string;
    untilMs: number;
    /** Start of a local `YYYY-MM-DDTHH` hour, as epoch ms. Timezone is the caller's. */
    hourStartMs: (hourKey: string) => number;
  },
): { moved: string[]; state: FloatingMeterState } {
  const { fromCategoryId, toCategoryId, untilMs, hourStartMs } = options;
  const source = state.categories[fromCategoryId];
  if (!source || fromCategoryId === toCategoryId) return { moved: [], state };
  const moved = Object.keys(source.hourly)
    .filter((hourKey) => {
      const start = hourStartMs(hourKey);
      return Number.isFinite(start) && start < untilMs;
    })
    .sort();
  if (moved.length === 0) return { moved, state };

  const from = { ...source, hourly: { ...source.hourly } };
  const existingTarget = state.categories[toCategoryId];
  const to = existingTarget
    ? { ...existingTarget, hourly: { ...existingTarget.hourly } }
    : { hourly: {}, kwhTotal: 0, lastMeasuredAt: null, lastWatts: 0, measuredSeconds: 0 };
  for (const hourKey of moved) {
    const bucket = from.hourly[hourKey];
    delete from.hourly[hourKey];
    const merged = to.hourly[hourKey] ?? { seconds: 0, wattSeconds: 0 };
    to.hourly[hourKey] = { seconds: merged.seconds + bucket.seconds, wattSeconds: merged.wattSeconds + bucket.wattSeconds };
    // Totals can hold history the 90-day prune has already dropped from the
    // buckets, so a move takes the bucket's own share and never more than the
    // source still has.
    const seconds = Math.min(from.measuredSeconds, bucket.seconds);
    const kwh = Math.min(from.kwhTotal, bucket.wattSeconds / 3_600_000);
    from.measuredSeconds -= seconds;
    from.kwhTotal -= kwh;
    to.measuredSeconds += seconds;
    to.kwhTotal += kwh;
  }
  return {
    moved,
    state: { ...state, categories: { ...state.categories, [fromCategoryId]: from, [toCategoryId]: to } },
  };
}

export type MeterHistoryPoint = { at: number; watts: number | null };

type HaHistoryRow = { last_changed?: string; last_updated?: string; state?: unknown };

/**
 * Flatten `/api/history/period` rows for a meter into one power series. The
 * first entity id is preferred; later ones stand in while it is unavailable,
 * the same ladder the live tick reads.
 */
export function meterHistoryPoints(response: unknown, entityIds: string[]): MeterHistoryPoint[] {
  const series = new Map<string, Array<{ at: number; watts: number | null }>>();
  const groups = Array.isArray(response) ? response : [];
  groups.forEach((group, groupIndex) => {
    if (!Array.isArray(group) || group.length === 0) return;
    // minimal_response omits entity_id after the first row of each group.
    const entityId = String((group[0] as { entity_id?: string }).entity_id ?? entityIds[groupIndex] ?? "");
    const rows = (group as HaHistoryRow[])
      .map((row) => {
        const at = Date.parse(String(row.last_changed ?? row.last_updated ?? ""));
        const value = Number(row.state);
        const live = row.state !== null && row.state !== "" && row.state !== "unknown" && row.state !== "unavailable";
        return { at, watts: live && Number.isFinite(value) ? value : null };
      })
      .filter((row) => Number.isFinite(row.at))
      .sort((a, b) => a.at - b.at);
    series.set(entityId, rows);
  });
  const times = [...new Set([...series.values()].flatMap((rows) => rows.map((row) => row.at)))].sort((a, b) => a - b);
  const latest = (rows: Array<{ at: number; watts: number | null }> | undefined, at: number) => {
    let value: number | null = null;
    for (const row of rows ?? []) {
      if (row.at > at) break;
      value = row.watts;
    }
    return value;
  };
  return times.map((at) => ({
    at,
    watts: entityIds.map((entityId) => latest(series.get(entityId), at)).find((value) => value !== null) ?? null,
  }));
}

export type RebuiltWash = { cycle: WashingMachineCycle; points: Array<[number, number]> };

/**
 * Replay a stretch of meter history through cycle detection with the current
 * config, ticking at the meter interval with each reading held until the next
 * one — which is how the live tick sees a report-on-change stream.
 *
 * Replay never alerts and never guesses a person: completion alerts and
 * pattern attribution are stripped, because neither may act retroactively
 * (§4.5, "Claimed-wash completion alerts").
 */
export function replayWashingHistory(options: {
  config: WashingMachineConfig;
  costPerKwhAt: (atMs: number) => number;
  fromMs: number;
  maxIntegrationHours: number;
  points: MeterHistoryPoint[];
  tickSeconds: number;
  toMs: number;
}): RebuiltWash[] {
  const { costPerKwhAt, fromMs, maxIntegrationHours, points, toMs } = options;
  const tickMs = Math.max(1, options.tickSeconds) * 1000;
  const config: WashingMachineConfig = { ...options.config, autoAttribution: undefined, completionAlert: undefined };
  let state: WashingMachineState = blankWashingMachineState();
  let trace: { anchor: string | null; points: Array<[number, number]> } = { anchor: null, points: [] };
  let lastTickMs: number | null = null;
  let index = 0;
  let watts: number | null = null;
  const rebuilt: RebuiltWash[] = [];

  for (let at = fromMs; at <= toMs; at += tickMs) {
    while (index < points.length && points[index].at <= at) {
      watts = points[index].watts;
      index += 1;
    }
    if (watts === null) {
      if (state.open) state = { ...state, open: { ...state.open, belowSince: null, zeroSince: null } };
      continue;
    }
    const elapsedHours = lastTickMs === null ? 0 : (at - lastTickMs) / 3_600_000;
    const iso = new Date(at).toISOString();
    const before = state.cycles.length;
    state = recordWashingMachineSample(state, {
      at: iso,
      config,
      costPerKwh: costPerKwhAt(at),
      elapsedHours: elapsedHours <= maxIntegrationHours ? elapsedHours : 0,
      reportedAt: iso,
      watts,
    });
    lastTickMs = at;
    for (const cycle of state.cycles.slice(before)) {
      const start = Date.parse(cycle.startedAt) / 1000;
      const end = Date.parse(cycle.endedAt) / 1000;
      rebuilt.push({
        cycle,
        points: trace.anchor === cycle.startedAt
          ? trace.points.filter(([sampleAt]) => sampleAt <= end).map(([sampleAt, value]) => [Math.round(sampleAt - start), value])
          : [],
      });
    }
    const anchor = state.open?.startedAt ?? state.open?.aboveSince ?? null;
    trace = anchor ? { anchor, points: trace.anchor === anchor ? trace.points : [] } : { anchor: null, points: [] };
    if (anchor) trace.points.push([Math.round(at / 1000), Math.round(watts * 10) / 10]);
  }
  return rebuilt;
}

/**
 * The rebuilt washes that no stored cycle already covers. A rebuilt wash that
 * overlaps a stored one in time — or the wash still running — is the same wash
 * and is skipped, so stored cycles and their attribution are never touched.
 */
export function newRebuiltWashes(state: WashingMachineState, rebuilt: RebuiltWash[], nowMs: number): RebuiltWash[] {
  const occupied = state.cycles.map((cycle) => [Date.parse(cycle.startedAt), Date.parse(cycle.endedAt)] as const);
  if (state.open?.startedAt) occupied.push([Date.parse(state.open.startedAt), nowMs]);
  const accepted: RebuiltWash[] = [];
  for (const wash of rebuilt) {
    const start = Date.parse(wash.cycle.startedAt);
    const end = Date.parse(wash.cycle.endedAt);
    const overlaps = [...occupied, ...accepted.map((item) => [Date.parse(item.cycle.startedAt), Date.parse(item.cycle.endedAt)] as const)]
      .some(([otherStart, otherEnd]) => start <= otherEnd && end >= otherStart);
    if (!overlaps && !state.cycles.some((cycle) => cycle.id === wash.cycle.id)) accepted.push(wash);
  }
  return accepted;
}
