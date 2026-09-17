/**
 * How a driver, its cadence and its lane read on screen. Split out of
 * `effectCatalogue.ts` (specs/agent-token-footprint.md §4).
 */
import type { PhonoscopeDriver, PhonoscopeDriverType } from "../../../lib/types";
import {
  driverFiresEvents,
  isPhonoscopeThemePulseEffect,
} from "../../../lib/phonoscope-drivers";

export const DRIVER_TYPES: PhonoscopeDriverType[] = [
  "beat", "downbeat", "timer", "song", "energy", "bass", "mid", "treble", "random",
];

const DRIVER_LABELS: Record<PhonoscopeDriverType, string> = {
  beat: "Beat",
  downbeat: "Downbeat",
  timer: "Timer",
  song: "Song",
  energy: "Energy",
  bass: "Bass",
  mid: "Mid",
  treble: "Treble",
  random: "Random",
};

/** The `every` choices. Ordinals read better than raw numbers on a cycle. */
export const EVERY_CHOICES = [1, 2, 3, 4, 6, 8, 12, 16];

/** The subdivisions, fastest first, as they read in the cadence list. */
export const DIVIDE_CHOICES: { divide: number; label: string }[] = [
  { divide: 8, label: "Eighth" },
  { divide: 4, label: "Quarter" },
  { divide: 2, label: "Half" },
];

/** The pulse a counted driver counts, as a noun: beats, or bars. */
export function driverPulseNoun(driver: PhonoscopeDriver) {
  const type = driver.type === "random" ? driver.cadence : driver.type;
  return type === "downbeat" ? "bar" : "beat";
}

/**
 * The single cadence list: subdivisions of the pulse, then the pulse itself,
 * then multiples of it. One control rather than two because they are one
 * question — how often — asked in two directions, and a list that runs
 * continuously from "eighth beat" to "every 16th" reads as that one question.
 *
 * Each option carries the `every`/`divide` pair it means, so the row never has
 * to reconstruct one from the other.
 */
export function cadenceChoices(driver: PhonoscopeDriver) {
  const noun = driverPulseNoun(driver);
  const subdivisions = driverSupportsDivide(driver)
    ? DIVIDE_CHOICES.map(({ divide, label }) => ({
        value: `1/${divide}`,
        label: `${label} ${noun}`,
        every: 1,
        divide,
      }))
    : [];
  return [
    ...subdivisions,
    ...EVERY_CHOICES.map((every) => ({
      value: String(every),
      label: every === 1 ? "Every one" : ordinal(every),
      every,
      divide: 1,
    })),
  ];
}

/** Which cadence option a driver currently sits on. */
export function cadenceValue(driver: PhonoscopeDriver) {
  return driver.divide > 1 ? `1/${driver.divide}` : String(driver.every);
}

export function ordinal(value: number) {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}

export function driverTypeLabel(type: PhonoscopeDriverType) {
  return DRIVER_LABELS[type] ?? type;
}

/**
 * How a lane reads in its collapsed header — "Every 4th downbeat, from the 2nd",
 * "Timer · 8.0s", "Downbeat + Bass".
 */
export function driverLabel(driver: PhonoscopeDriver): string {
  const base = driverTypeLabel(driver.type);
  if (driver.type === "timer") {
    const suffix = driver.every > 1 ? `, every ${ordinal(driver.every)}` : "";
    return `Timer · ${driver.intervalSeconds.toFixed(1)}s${suffix}`;
  }
  if (driver.type === "random") {
    // "Within" rather than "on": the fire lands somewhere inside the window,
    // not at its edge, and `every` widens that window rather than skipping it.
    if (driver.divide > 1) return `Random within each ${subdivisionLabel(driver).toLowerCase()}`;
    const noun = driverTypeLabel(driver.cadence).toLowerCase();
    return driver.every > 1
      ? `Random within every ${driver.every} ${noun}s`
      : `Random within each ${noun}`;
  }
  if (driver.type !== "beat" && driver.type !== "downbeat" && driver.type !== "song") {
    return base;
  }
  // A subdivided lane is faster than the pulse it names, so the subdivision is
  // the whole story — there is no cycle left to offset within.
  if (driver.divide > 1) return subdivisionLabel(driver);
  if (driver.every <= 1) return base;
  const cycle = `Every ${ordinal(driver.every)} ${base.toLowerCase()}`;
  return driver.offset > 0 ? `${cycle}, from the ${ordinal(driver.offset + 1)}` : cycle;
}

export function laneLabel(driver: PhonoscopeDriver, modifiers: PhonoscopeDriver[]) {
  const extra = modifiers.map((modifier) => driverTypeLabel(modifier.type)).join(" + ");
  return extra ? `${driverLabel(driver)} + ${extra}` : driverLabel(driver);
}

/** "Quarter beat", "Half bar" — how a subdivided driver reads. */
export function subdivisionLabel(driver: PhonoscopeDriver) {
  const named = DIVIDE_CHOICES.find((choice) => choice.divide === driver.divide);
  return `${named?.label ?? `1/${driver.divide}`} ${driverPulseNoun(driver)}`;
}

/**
 * Only the two musical pulses subdivide. A song cannot be cut in half, and a
 * timer's interval is already a free-running number — halving it is what the
 * interval slider is for.
 */
export function driverSupportsDivide(driver: PhonoscopeDriver) {
  const type = driver.type === "random" ? driver.cadence : driver.type;
  return type === "beat" || type === "downbeat";
}

/** `every`/`offset` only mean anything on a counted pulse. */
export function driverSupportsCycle(driver: PhonoscopeDriver) {
  // On `random` the pair sizes the window it fires somewhere inside rather than
  // selecting which pulses count, but it is the same two controls either way.
  return driverFiresEvents(driver);
}

/**
 * A level driver carries no discrete event, so it can never advance the colour
 * rotation or flip the alt state. The editor says so rather than letting the
 * binding sit there inert.
 */
export function effectNeedsPulseDriver(effectId: string) {
  return isPhonoscopeThemePulseEffect(effectId);
}
