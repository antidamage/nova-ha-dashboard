// Reading a wash's own samples, and what they say about the temperature it ran at
// (specs/power-meters.md §4.6, §5.3).
//
// A trace file keeps one point per meter tick — [seconds from the wash's start,
// watts] for a closed wash, and absolute instants for the one under way — so this
// is where the two shapes are turned into the one the models take, and where the
// month's traces are opened for their temperatures. The classifiers themselves are
// pure: `wash-temperature.ts` holds them.
import path from "path";
import type { WashingMachineConfig } from "../config-schema";
import { cyclesInMonth, type WashingMachineState } from "../washing-machine";
import { localMonthKey } from "./calendar";
import { readJson, WASH_TRACE_DIR } from "./store";
import type { OpenWashTrace, WashTraceFile } from "./types";
import type { WashDetailSample } from "./wash-detail";
import { washTemperature, type WashTemperature } from "./wash-temperature";
import { cyclePlaceholder } from "./wash-months";

const OPEN_TRACE_PATH = path.join(WASH_TRACE_DIR, "open.json");

/** A closed wash's own samples, in the shape its trace file keeps (§4.6). */
export async function tracePoints(id: string): Promise<WashDetailSample[]> {
  const trace = await readJson<WashTraceFile | null>(path.join(WASH_TRACE_DIR, `${id}.json`), null);
  return trace?.points ?? [];
}

/** The open wash's samples, rebased onto the instant it started. */
export async function openPoints(startedAt: string): Promise<WashDetailSample[]> {
  const trace = await readJson<OpenWashTrace | null>(OPEN_TRACE_PATH, null);
  if (!trace || trace.anchor !== startedAt) {
    return [];
  }
  const start = Date.parse(startedAt) / 1000;
  return trace.points.map(([at, value]): WashDetailSample => [Math.round(at - start), value]);
}

/**
 * What each wash's own trace says about the temperature it ran at (§5.3).
 *
 * Read for the month a page is about to show, so the files opened are the ones
 * those washes have. The bill itself carries no curves — it is read once, not
 * polled — but the plateau has to be measured from the samples, and a closed wash
 * whose trace kept nothing comes back **unmeasured** rather than cold.
 */
export async function readWashTemperatures(
  state: WashingMachineState,
  monthKey: string,
  config: WashingMachineConfig,
): Promise<Map<string, WashTemperature>> {
  const temperatures = new Map<string, WashTemperature>();
  // The gap the wash's own timer trusts is the one the samples are read with (§4.5):
  // two element runs either side of a longer gap are two runs, not one.
  const maxGapSeconds = config.timer.maxSampleGapSeconds;
  for (const cycle of cyclesInMonth(state.cycles, monthKey, (iso) => localMonthKey(new Date(iso)))) {
    temperatures.set(
      cycle.id,
      washTemperature(await tracePoints(cycle.id), config.temperature, { complete: true, maxGapSeconds }),
    );
  }
  const open = state.open?.startedAt ? state.open : null;
  if (open?.startedAt && localMonthKey(new Date(open.startedAt)) === monthKey) {
    temperatures.set(
      cyclePlaceholder,
      washTemperature(await openPoints(open.startedAt), config.temperature, { complete: false, maxGapSeconds }),
    );
  }
  return temperatures;
}
