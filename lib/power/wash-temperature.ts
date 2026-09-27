// What a wash's own heat-up says about the cycle temperature somebody chose
// (specs/power-meters.md §5.3).
//
// A washing machine's element is the only part of a cycle that draws kilowatts,
// and it stays on until the water reaches the thermostat's target — so the trace
// carries the temperature as a *duration*. The plateau at the element's own draw
// is the water being brought up to the button that was pressed, and its length is
// linear in the rise the machine had to make from the mains it filled from. A
// cold cycle shows no plateau at all, which is why "the element never ran" is a
// reading rather than a missing one.
//
// The numbers below are this machine's, measured from its own traces and labelled
// by the person who ran those washes: its 899 s heat-up was a 40° cycle and its
// 487 s one a 30° — an 18 °C fill at about 41 s of heating per degree of rise,
// which is what `power.washingMachine.temperature` holds (§4.1's rule: the
// thresholds are config, not code).
//
// Pure: the samples, the machine's numbers and whether the wash has finished are
// all arguments. The store read is wash-history.ts's (§5.3).
import type { WashingMachineConfig } from "../config-schema";
import type { WashDetailSample } from "./wash-detail";

export type WashTemperatureConfig = NonNullable<WashingMachineConfig["temperature"]>;

/** The machine's heat-up, as a wash's own trace showed it. */
export type WashHeatUp = {
  /** How long the element ran, in seconds, and what it drew while it did. */
  seconds: number;
  watts: number;
  /** The element was still on in the wash's last sample, so the rise is partial. */
  open: boolean;
};

/**
 * The temperature a wash ran at: **`degrees`** when the element's run names one of
 * the machine's buttons, **`cold`** when the wash finished and the element never
 * ran, and **`unmeasured`** when the trace cannot say — nothing kept, or a wash
 * still running whose heat-up may simply not have happened yet.
 */
export type WashTemperature = {
  source: "cold" | "degrees" | "unmeasured";
  /** The button that was pressed, in °C, when the heat-up names one. */
  degrees: number | null;
  /** The heat-up itself, so a reader can be told what the answer rests on. */
  heatUp: WashHeatUp;
};

/**
 * The longest unbroken stretch the element was on, **near the start of the cycle**.
 *
 * Three things decide whether a run of the element is a cycle's heat-up, and each
 * of them is what the trace says rather than a guess:
 *
 * - **It has to start early.** A cycle that holds a temperature re-heats in bursts
 *   as the water cools, and those bursts can be longer than a short heat-up was; the
 *   water is hot by then, so only a run that begins inside `heatUpBySeconds` of the
 *   start is the load being brought up.
 * - **A sampling gap ends it.** The meter says nothing about the stretch it did not
 *   observe, so two runs either side of a gap longer than `maxGapSeconds` are two
 *   runs — the same limit the wash's own timer trusts (§4.5).
 * - **A run still going in the last sample is open**, which means a wash that has
 *   not finished has not finished heating either.
 *
 * Sampling is one point per meter tick (~10 s here), so a run's length is its own
 * span between its first and last sample at the element's draw.
 */
export function washHeatUp(
  points: WashDetailSample[],
  config: WashTemperatureConfig,
  maxGapSeconds: number,
): WashHeatUp {
  let best: WashHeatUp = { open: false, seconds: 0, watts: 0 };
  let start = -1;
  let previous = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const seconds = points[end - 1][0] - points[start][0];
    if (seconds > best.seconds) {
      const run = points.slice(start, end);
      best = {
        open: end === points.length,
        seconds,
        watts: run.reduce((sum, [, value]) => sum + value, 0) / run.length,
      };
    }
    start = -1;
  };
  points.forEach(([seconds, value], index) => {
    if (start >= 0 && seconds - previous > maxGapSeconds) close(index);
    if (value >= config.heaterWatts) {
      if (start < 0 && seconds <= config.heatUpBySeconds) start = index;
    } else {
      close(index);
    }
    previous = seconds;
  });
  close(points.length);
  return best;
}

/**
 * The temperature a wash was set to, from the heat-up its trace shows.
 *
 * The rise is read straight off the element's run (`inlet + seconds / seconds per
 * degree`) and then snapped to the buttons the machine actually offers, because
 * the answer a reader wants is which cycle was chosen, not a measurement to the
 * degree. A run shorter than `minimumSeconds` is not a heat-up — it is the element
 * topping up, or a blip the meter caught — so it reads as no heat-up at all.
 */
export function washTemperature(
  points: WashDetailSample[],
  config: WashTemperatureConfig,
  options: { complete: boolean; maxGapSeconds: number },
): WashTemperature {
  const heatUp = washHeatUp(points, config, options.maxGapSeconds);
  if (points.length === 0) {
    return { degrees: null, heatUp, source: "unmeasured" };
  }
  if (heatUp.seconds >= config.minimumSeconds) {
    // The element is on in the wash's last sample: the water is still coming up, so
    // the rise so far is not the temperature that was chosen — yet.
    if (heatUp.open && !options.complete) {
      return { degrees: null, heatUp, source: "unmeasured" };
    }
    const rise = config.inletDegrees + heatUp.seconds / config.secondsPerDegree;
    return { degrees: nearest(rise, config.options), heatUp, source: "degrees" };
  }
  // No element: a cold cycle once the wash has finished, and nothing said about
  // one still running — its heat-up may simply not have happened yet.
  return { degrees: null, heatUp, source: options.complete ? "cold" : "unmeasured" };
}

/** The offered temperature closest to a rise the heat-up measured. */
function nearest(degrees: number, options: number[]) {
  return options.reduce((best, option) => (Math.abs(option - degrees) < Math.abs(best - degrees) ? option : best));
}
