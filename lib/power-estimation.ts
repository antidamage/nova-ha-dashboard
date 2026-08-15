import type { PowershopDailyUsageRecord } from "./powershop-usage";

export const POWERSHOP_ESTIMATE_HALF_LIFE_DAYS = 28;

type PeriodSummary = {
  costNzd: number;
  kwh: number;
  projectedCostNzd: number;
  projectedKwh: number;
};

export type PowershopEstimateCalibration = {
  confidence: "high" | "medium" | "low" | "modeled";
  halfLifeDays: number;
  historyDays: number;
  intervalDays: number;
  lastActualDate: string | null;
  source: "powershop_hourly" | "powershop_daily" | "modeled";
};

export type PowershopEstimateResult = {
  calibration: PowershopEstimateCalibration;
  currentCostPerHourNzd: number;
  currentUsageRateCents: number;
  currentWatts: number;
  day: PeriodSummary;
  month: PeriodSummary;
  week: PeriodSummary;
};

type EstimateOptions = {
  billingEndDate: string;
  billingStartDate: string;
  currentUsageRateCents: number;
  fallbackCurrentCostPerHourNzd: number;
  fallbackCurrentWatts: number;
  fallbackDailyCostNzd: number;
  fallbackDailyKwh: number;
  localElapsedCostNzd: number;
  localElapsedKwh: number;
  nowHour: number;
  today: string;
  weekStartDate: string;
};

type ExpectedUsage = { costNzd: number; kwh: number };
type WeightedValue = ExpectedUsage & { usageCostNzd: number; weight: number };

function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function dateAtNoon(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function addDays(dateKey: string, days: number) {
  const date = dateAtNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round((dateAtNoon(to).getTime() - dateAtNoon(from).getTime()) / 86_400_000);
}

function weekday(dateKey: string) {
  return dateAtNoon(dateKey).getUTCDay();
}

function isWeekend(dateKey: string) {
  const day = weekday(dateKey);
  return day === 0 || day === 6;
}

function similarityWeight(historyDate: string, targetDate: string) {
  if (weekday(historyDate) === weekday(targetDate)) {
    return 2.5;
  }
  if (isWeekend(historyDate) === isWeekend(targetDate)) {
    return 1.25;
  }
  return 1;
}

function recencyWeight(historyDate: string, targetDate: string, today: string) {
  const ageDays = Math.max(1, daysBetween(historyDate, today));
  return 2 ** (-ageDays / POWERSHOP_ESTIMATE_HALF_LIFE_DAYS) * similarityWeight(historyDate, targetDate);
}

function weightedMean(values: WeightedValue[], fallback: ExpectedUsage) {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  if (totalWeight <= 0) {
    return { ...fallback, usageCostNzd: 0 };
  }
  return {
    costNzd: values.reduce((sum, value) => sum + value.costNzd * value.weight, 0) / totalWeight,
    kwh: values.reduce((sum, value) => sum + value.kwh * value.weight, 0) / totalWeight,
    usageCostNzd: values.reduce((sum, value) => sum + value.usageCostNzd * value.weight, 0) / totalWeight,
  };
}

function validDailyRecords(records: PowershopDailyUsageRecord[], today: string) {
  return records
    .filter(
      (record) =>
        record.status === "ok" &&
        record.targetDate < today &&
        Number.isFinite(record.values?.kwh) &&
        Number.isFinite(record.values?.costNzd) &&
        Number(record.values?.kwh) >= 0 &&
        Number(record.values?.costNzd) >= 0,
    )
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
}

function expectedDay(
  records: PowershopDailyUsageRecord[],
  targetDate: string,
  today: string,
  fallback: ExpectedUsage,
) {
  return weightedMean(
    records.map((record) => ({
      costNzd: Number(record.values?.costNzd),
      kwh: Number(record.values?.kwh),
      usageCostNzd: 0,
      weight: recencyWeight(record.targetDate, targetDate, today),
    })),
    fallback,
  );
}

function intervalHour(startAt: string) {
  const hour = Number(startAt.slice(11, 13));
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function expectedHourlyProfile(
  records: PowershopDailyUsageRecord[],
  targetDate: string,
  today: string,
  expected: ExpectedUsage,
) {
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const values: WeightedValue[] = [];
    for (const record of records) {
      for (const interval of record.intervals ?? []) {
        if (
          intervalHour(interval.startAt) !== hour ||
          !Number.isFinite(interval.kwh) ||
          !Number.isFinite(interval.costNzd) ||
          interval.kwh < 0 ||
          interval.costNzd < 0
        ) {
          continue;
        }
        values.push({
          costNzd: interval.costNzd,
          kwh: interval.kwh,
          usageCostNzd: Number.isFinite(interval.usageCostNzd) ? interval.usageCostNzd : 0,
          weight: recencyWeight(record.targetDate, targetDate, today),
        });
      }
    }
    return weightedMean(values, { costNzd: expected.costNzd / 24, kwh: expected.kwh / 24 });
  });
  const profileKwh = hours.reduce((sum, hour) => sum + hour.kwh, 0);
  const profileCost = hours.reduce((sum, hour) => sum + hour.costNzd, 0);
  const kwhScale = profileKwh > 0 ? expected.kwh / profileKwh : 1;
  return hours.map((hour) => ({
    costNzd: profileCost > 0 ? (hour.costNzd / profileCost) * expected.costNzd : expected.costNzd / 24,
    kwh: profileKwh > 0 ? hour.kwh * kwhScale : expected.kwh / 24,
    usageCostNzd: hour.usageCostNzd * kwhScale,
  }));
}

function cumulativeAtHour(profile: Array<ExpectedUsage & { usageCostNzd: number }>, nowHour: number) {
  const boundedHour = Math.max(0, Math.min(24, nowHour));
  const fullHours = Math.floor(boundedHour);
  const partial = boundedHour - fullHours;
  return profile.reduce(
    (sum, interval, hour) => {
      const fraction = hour < fullHours ? 1 : hour === fullHours ? partial : 0;
      sum.costNzd += interval.costNzd * fraction;
      sum.kwh += interval.kwh * fraction;
      return sum;
    },
    { costNzd: 0, kwh: 0 },
  );
}

function adjustedDayProjection(elapsed: ExpectedUsage, profileElapsed: ExpectedUsage, expected: ExpectedUsage, dayFraction: number) {
  const progressTrust = Math.min(0.65, Math.max(0, dayFraction) * 0.85);
  const kwhRatio = profileElapsed.kwh > 0 ? Math.max(0.5, Math.min(2, elapsed.kwh / profileElapsed.kwh)) : 1;
  const costRatio = profileElapsed.costNzd > 0 ? Math.max(0.5, Math.min(2, elapsed.costNzd / profileElapsed.costNzd)) : 1;
  return {
    costNzd: elapsed.costNzd + Math.max(0, expected.costNzd - profileElapsed.costNzd) * (1 + (costRatio - 1) * progressTrust),
    kwh: elapsed.kwh + Math.max(0, expected.kwh - profileElapsed.kwh) * (1 + (kwhRatio - 1) * progressTrust),
  };
}

function periodSummary(
  startDate: string,
  endDate: string,
  today: string,
  actualByDate: Map<string, ExpectedUsage>,
  expectedForDate: (date: string) => ExpectedUsage,
  todayElapsed: ExpectedUsage,
  todayProjected: ExpectedUsage,
): PeriodSummary {
  let elapsedCostNzd = 0;
  let elapsedKwh = 0;
  let projectedCostNzd = 0;
  let projectedKwh = 0;
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const expected = expectedForDate(date);
    const actual = actualByDate.get(date);
    const projected = actual ?? (date === today ? todayProjected : expected);
    projectedCostNzd += projected.costNzd;
    projectedKwh += projected.kwh;
    if (date < today) {
      elapsedCostNzd += (actual ?? expected).costNzd;
      elapsedKwh += (actual ?? expected).kwh;
    } else if (date === today) {
      elapsedCostNzd += todayElapsed.costNzd;
      elapsedKwh += todayElapsed.kwh;
    }
  }
  return {
    costNzd: round(elapsedCostNzd, 2),
    kwh: round(elapsedKwh),
    projectedCostNzd: round(projectedCostNzd, 2),
    projectedKwh: round(projectedKwh),
  };
}

export function calibratePowershopEstimates(
  allRecords: PowershopDailyUsageRecord[],
  options: EstimateOptions,
): PowershopEstimateResult {
  const records = validDailyRecords(allRecords, options.today);
  const fallbackDay = { costNzd: options.fallbackDailyCostNzd, kwh: options.fallbackDailyKwh };
  const todayExpected = expectedDay(records, options.today, options.today, fallbackDay);
  const intervalDays = records.filter((record) => (record.intervals?.length ?? 0) >= 20).length;
  const profile = expectedHourlyProfile(records, options.today, options.today, todayExpected);
  const profileElapsed = cumulativeAtHour(profile, options.nowHour);
  const todayElapsed = {
    costNzd: Math.max(profileElapsed.costNzd, options.localElapsedCostNzd),
    kwh: Math.max(profileElapsed.kwh, options.localElapsedKwh),
  };
  const dayFraction = options.nowHour / 24;
  const todayProjected = adjustedDayProjection(todayElapsed, profileElapsed, todayExpected, dayFraction);
  const currentHour = Math.max(0, Math.min(23, Math.floor(options.nowHour)));
  const expectedCurrent = profile[currentHour];
  const profileWatts = expectedCurrent.kwh * 1000;
  const currentWatts = Math.max(profileWatts, options.fallbackCurrentWatts);
  const inferredUsageRateCents = expectedCurrent.kwh > 0
    ? (expectedCurrent.usageCostNzd / expectedCurrent.kwh) * 100
    : options.currentUsageRateCents;
  const currentUsageRateCents = inferredUsageRateCents > 0 ? inferredUsageRateCents : options.currentUsageRateCents;
  const currentCostPerHourNzd = Math.max(
    expectedCurrent.costNzd,
    options.fallbackCurrentCostPerHourNzd + (Math.max(0, currentWatts - options.fallbackCurrentWatts) / 1000) * (currentUsageRateCents / 100),
  );
  const actualByDate = new Map(
    records.map((record) => [
      record.targetDate,
      { costNzd: Number(record.values?.costNzd), kwh: Number(record.values?.kwh) },
    ]),
  );
  const expectedForDate = (date: string) => expectedDay(records, date, options.today, fallbackDay);
  const weekEndDate = addDays(options.weekStartDate, 6);
  const historyDays = records.length;
  const lastActualDate = records.at(-1)?.targetDate ?? null;
  const ageOfLatest = lastActualDate ? daysBetween(lastActualDate, options.today) : Number.POSITIVE_INFINITY;
  const confidence =
    historyDays >= 56 && intervalDays >= 28 && ageOfLatest <= 2
      ? "high"
      : historyDays >= 21 && intervalDays >= 7 && ageOfLatest <= 4
        ? "medium"
        : historyDays > 0
          ? "low"
          : "modeled";

  return {
    calibration: {
      confidence,
      halfLifeDays: POWERSHOP_ESTIMATE_HALF_LIFE_DAYS,
      historyDays,
      intervalDays,
      lastActualDate,
      source: intervalDays >= 7 ? "powershop_hourly" : historyDays >= 7 ? "powershop_daily" : "modeled",
    },
    currentCostPerHourNzd: round(currentCostPerHourNzd, 3),
    currentUsageRateCents: round(currentUsageRateCents, 2),
    currentWatts: round(currentWatts, 1),
    day: {
      costNzd: round(todayElapsed.costNzd, 2),
      kwh: round(todayElapsed.kwh),
      projectedCostNzd: round(todayProjected.costNzd, 2),
      projectedKwh: round(todayProjected.kwh),
    },
    month: periodSummary(
      options.billingStartDate,
      options.billingEndDate,
      options.today,
      actualByDate,
      expectedForDate,
      todayElapsed,
      todayProjected,
    ),
    week: periodSummary(
      options.weekStartDate,
      weekEndDate,
      options.today,
      actualByDate,
      expectedForDate,
      todayElapsed,
      todayProjected,
    ),
  };
}
