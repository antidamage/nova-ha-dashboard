import { recencyWeight } from "../power-estimation";
import type { FloatingMeterCategory, FloatingMeterConfig } from "../config-schema";

/**
 * The floating meter: one metering plug that moves between groups of devices.
 *
 * It measures one group at a time. The groups it is not on are estimated from
 * what measuring them previously taught, so every period the meter spends
 * somewhere makes the whole household estimate more accurate. See
 * specs/power-meters.md §3.
 */

/** Raw observations for one dated hour while a category was being measured. */
export type FloatingMeterHourBucket = { seconds: number; wattSeconds: number };

export type FloatingMeterCategoryState = {
  hourly: Record<string, FloatingMeterHourBucket>;
  kwhTotal: number;
  lastMeasuredAt: string | null;
  lastWatts: number;
  measuredSeconds: number;
};

export type FloatingMeterState = {
  activeCategoryId: string | null;
  activeSince: string | null;
  categories: Record<string, FloatingMeterCategoryState>;
};

export type FloatingMeterConfidence = "measured" | "high" | "medium" | "assumed";

export type FloatingMeterCategoryReading = {
  active: boolean;
  confidence: FloatingMeterConfidence;
  icon: FloatingMeterCategory["icon"];
  id: string;
  label: string;
  measuredHours: number;
  members: string[];
  suppressesBaseLoads: FloatingMeterCategory["suppressesBaseLoads"];
  watts: number;
};

/** Observations older than this are dropped, as `pruneState` does elsewhere. */
export const FLOATING_METER_HISTORY_DAYS = 90;

export function blankFloatingMeterState(): FloatingMeterState {
  return { activeCategoryId: null, activeSince: null, categories: {} };
}

export function blankCategoryState(): FloatingMeterCategoryState {
  return { hourly: {}, kwhTotal: 0, lastMeasuredAt: null, lastWatts: 0, measuredSeconds: 0 };
}

/** `YYYY-MM-DDTHH` — the same bucket key shape the power state already uses. */
function bucketDate(hourKey: string) {
  return hourKey.slice(0, 10);
}

function bucketHour(hourKey: string) {
  return hourKey.slice(11, 13);
}

/**
 * Fold one sample into the active category. `hourKey` and `dateKey` come from
 * the caller so the whole module stays free of timezone handling — local time
 * is `power.timeZone`'s business, and `lib/power.ts` already owns it.
 */
export function recordFloatingSample(
  state: FloatingMeterState,
  categoryId: string,
  watts: number,
  elapsedSeconds: number,
  hourKey: string,
  at: string,
  /** Measured energy for the interval from a kWh counter, replacing watts x time. */
  energyWattSeconds?: number,
) {
  const category = (state.categories[categoryId] ??= blankCategoryState());
  category.lastWatts = watts;
  category.lastMeasuredAt = at;
  if (elapsedSeconds <= 0) {
    return;
  }
  const bucket = (category.hourly[hourKey] ??= { seconds: 0, wattSeconds: 0 });
  const wattSeconds = energyWattSeconds !== undefined && Number.isFinite(energyWattSeconds) && energyWattSeconds >= 0
    ? energyWattSeconds
    : watts * elapsedSeconds;
  bucket.seconds += elapsedSeconds;
  bucket.wattSeconds += wattSeconds;
  category.measuredSeconds += elapsedSeconds;
  category.kwhTotal += wattSeconds / 3_600_000;
}

export function pruneFloatingMeterState(state: FloatingMeterState, cutoffDateKey: string) {
  for (const category of Object.values(state.categories)) {
    for (const hourKey of Object.keys(category.hourly)) {
      if (bucketDate(hourKey) < cutoffDateKey) {
        delete category.hourly[hourKey];
      }
    }
  }
}

function weightedMean(
  buckets: Array<[string, FloatingMeterHourBucket]>,
  today: string,
): number | null {
  let weightTotal = 0;
  let valueTotal = 0;
  for (const [hourKey, bucket] of buckets) {
    if (bucket.seconds <= 0) {
      continue;
    }
    // Weighted by how long we watched and how recent (and how alike) that day
    // was. `recencyWeight` is the estimator's own scheme, reused rather than
    // reinvented — a second weighting scheme here would be a defect.
    const weight = bucket.seconds * recencyWeight(bucketDate(hourKey), today, today);
    if (weight <= 0) {
      continue;
    }
    weightTotal += weight;
    valueTotal += (bucket.wattSeconds / bucket.seconds) * weight;
  }
  return weightTotal > 0 ? valueTotal / weightTotal : null;
}

/**
 * What one category is drawing right now, and how much that number is worth.
 *
 * The ladder, from specs/power-meters.md §3.3:
 *   1. the meter is on it            -> the live reading, `measured`
 *   2. enough history, this hour     -> weighted hour-of-day mean, `high`
 *   3. enough history, other hours   -> flat weighted mean, `medium`
 *   4. otherwise                     -> the configured seed, `assumed`
 */
export function categoryReading(
  category: FloatingMeterCategory,
  state: FloatingMeterState,
  options: {
    activeWatts: number | null;
    hourOfDay: string;
    minLearnedHours: number;
    today: string;
  },
): FloatingMeterCategoryReading {
  const persisted = state.categories[category.id] ?? blankCategoryState();
  const measuredHours = persisted.measuredSeconds / 3600;
  const base = {
    icon: category.icon,
    id: category.id,
    label: category.label,
    measuredHours: Math.round(measuredHours * 10) / 10,
    members: category.members,
    suppressesBaseLoads: category.suppressesBaseLoads,
  };

  const active = state.activeCategoryId === category.id;
  if (active && options.activeWatts !== null) {
    return { ...base, active: true, confidence: "measured", watts: options.activeWatts };
  }

  const buckets = Object.entries(persisted.hourly);
  if (measuredHours >= options.minLearnedHours) {
    const thisHour = buckets.filter(([hourKey]) => bucketHour(hourKey) === options.hourOfDay);
    const hourMean = weightedMean(thisHour, options.today);
    if (hourMean !== null) {
      return { ...base, active, confidence: "high", watts: Math.round(hourMean * 10) / 10 };
    }
    const flatMean = weightedMean(buckets, options.today);
    if (flatMean !== null) {
      return { ...base, active, confidence: "medium", watts: Math.round(flatMean * 10) / 10 };
    }
  }

  return { ...base, active, confidence: "assumed", watts: category.seedWatts };
}

export function floatingMeterReadings(
  config: FloatingMeterConfig,
  state: FloatingMeterState,
  options: { activeWatts: number | null; hourOfDay: string; today: string },
): FloatingMeterCategoryReading[] {
  return config.categories.map((category) =>
    categoryReading(category, state, {
      activeWatts: options.activeWatts,
      hourOfDay: options.hourOfDay,
      minLearnedHours: config.minLearnedHours,
      today: options.today,
    }),
  );
}

/**
 * The modelled base loads these categories stand in for.
 *
 * A category contributes whether it is measured or modelled, so its overlapping
 * base load is withheld in both states — which is why the grid total does not
 * jump when the meter moves. See specs/power-meters.md §3.4.
 */
export function suppressedBaseLoadIds(readings: FloatingMeterCategoryReading[]): Set<string> {
  const suppressed = new Set<string>();
  for (const reading of readings) {
    for (const id of reading.suppressesBaseLoads) {
      suppressed.add(id);
    }
  }
  return suppressed;
}
