// One wash, as the laundry page's detail sheet states it: the run's own labels,
// what it used and cost, and the watts it drew at every sample the meter kept
// (specs/power-meters.md §5.3).
//
// Pure. The cycle, its samples, the plan and the household's people are all
// arguments, so a detail can be built from a fixture — and the samples arrive as
// [seconds from the start, watts] with the reader owning the two file shapes a
// trace has: a closed wash's points are already relative to its own start, and
// the open one's carry absolute instants (§4.6). This file owns what the page
// says about them.
import type { HouseholdPerson } from "../config-schema";
import type { WashingMachineCycle } from "../washing-machine";
import { wallClockLabel, washDurationLabel } from "../washing-machine/history-model";
import { localMonthKey, localParts, localWallMs, monthNames } from "./calendar";
import type { WashMonthRate } from "./types";
import type { WashTemperature } from "./wash-temperature";

/** One sample of the run: seconds since it started, and the watts at that moment. */
export type WashDetailSample = [number, number];

export type WashDetail = {
  /** The wash's own id, so the sheet claims it through the same write the row uses. */
  id: string;
  /** The wash under way, which has no stored cycle yet. */
  running: boolean;
  person: string | null;
  /** `Sat 19 Sep 2026`. */
  dateLabel: string;
  /** `2:05 PM` and `3:27 PM`, and how long it ran. */
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  durationSeconds: number;
  kwh: number;
  costNzd: number;
  /**
   * What the wash's own electricity cost per kWh — its cost over its energy, so
   * a wash run inside a retailer's free or cheap window reads as the cheaper rate
   * it actually drew at (§4.1). Null when it drew nothing.
   */
  cPerKwh: number | null;
  /** The highest watts any sample read, and how far into the run that was. */
  peakWatts: number;
  peakAtSeconds: number;
  /** Its energy spread over its own duration: the draw it averaged, not the samples'. */
  averageWatts: number;
  samples: number;
  /** Every stored sample, in the order the meter wrote them. */
  points: WashDetailSample[];
  /** The month the bill counts it in — the one it ended in (§5.3). */
  monthKey: string;
  /** The cycle's temperature, as this wash's own samples show it (§5.3). */
  temperature: WashTemperature;
  rate: WashMonthRate;
  people: HouseholdPerson[];
};

/**
 * What the sheet states about one wash.
 *
 * **Every sample is carried.** `downsampleTrace`'s 48 points are the panel's
 * block, sized to the width of a card (§5.2); this sheet is the run's own
 * detail, so it plots what the meter actually kept — a ninety-minute wash is
 * several hundred points — and the page says how many.
 */
export function buildWashDetail(options: {
  cycle: WashingMachineCycle;
  points: WashDetailSample[];
  rate: WashMonthRate;
  people: HouseholdPerson[];
  running: boolean;
  /** Read from these same samples by the caller, which holds the machine's own numbers (§5.3). */
  temperature: WashTemperature;
}): WashDetail {
  const { cycle, points, rate, people, running, temperature } = options;
  const from = Date.parse(cycle.startedAt);
  const to = Date.parse(cycle.endedAt);
  const parts = localParts(new Date(from));
  const durationSeconds = Math.max(0, Math.round((to - from) / 1000));
  const watts = points.map(([, value]) => value);
  const peakWatts = watts.length > 0 ? Math.max(0, ...watts) : 0;
  return {
    averageWatts: durationSeconds > 0 ? Math.round((cycle.kwh * 1000) / (durationSeconds / 3600)) : 0,
    costNzd: cycle.costNzd,
    cPerKwh: cycle.kwh > 0 ? (cycle.costNzd / cycle.kwh) * 100 : null,
    dateLabel: `${parts.weekday} ${Number(parts.day)} ${monthNames[parts.month - 1]} ${parts.year}`,
    durationLabel: washDurationLabel(to - from),
    durationSeconds,
    endLabel: wallClockLabel(localWallMs(new Date(to))),
    id: cycle.id,
    kwh: cycle.kwh,
    monthKey: localMonthKey(new Date(to)),
    peakAtSeconds: watts.indexOf(peakWatts) >= 0 ? points[watts.indexOf(peakWatts)][0] : 0,
    peakWatts,
    people,
    person: cycle.person,
    points,
    rate,
    running,
    samples: points.length,
    startLabel: wallClockLabel(localWallMs(new Date(from))),
    temperature,
  };
}

/**
 * The watts the graph's own axis tops out at, and the step between its gridlines:
 * the smallest of a short ladder of readable steps whose four intervals clear the
 * peak, so a spin tops out at 100 W and a hot wash at 3,000 W, and no gridline is
 * ever labelled a number nobody would write down.
 */
export function wattsAxis(peakWatts: number) {
  const step = [25, 50, 100, 200, 250, 500, 1000, 2000, 2500].find((value) => value * 3 >= peakWatts) ?? 2500;
  return { step, top: step * 3 };
}
