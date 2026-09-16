// Buckets, period projections, graph series and state pruning.
import type { PowerAccountUsagePoint } from "../config-schema";
import { modeledDailyBaseKwh } from "./base-load";
import {
  currentKeys,
  dateKeyFromParts,
  daysInMonth,
  hourKeyFromParts,
  localParts,
  monthFromLabel,
} from "./calendar";
import { FLOATING_METER_HISTORY_DAYS, pruneFloatingMeterState } from "./floating-meter";
import { round } from "./numbers";
import { powerConfig } from "./store";
import { tariff } from "./tariff";
import type { PowerBackgroundEstimatePoint, PowerBucket, PowerPeriodSummary, PowerState } from "./types";

export function addBucket(bucket: PowerBucket | undefined, kwh: number, costNzd: number): PowerBucket {
  return {
    costNzd: round((bucket?.costNzd ?? 0) + costNzd, 4),
    kwh: round((bucket?.kwh ?? 0) + kwh, 5),
  };
}

export function sumBuckets(state: PowerState, from: string, to: string) {
  return Object.entries(state.daily).reduce(
    (sum, [key, bucket]) => {
      if (key >= from && key <= to) {
        sum.kwh += bucket.kwh;
        sum.costNzd += bucket.costNzd;
      }
      return sum;
    },
    { costNzd: 0, kwh: 0 },
  );
}

function projected(summary: { costNzd: number; kwh: number }, fraction: number): PowerPeriodSummary {
  const safeFraction = Math.max(0.04, Math.min(1, fraction));
  return {
    costNzd: round(summary.costNzd, 2),
    kwh: round(summary.kwh, 3),
    projectedCostNzd: round(summary.costNzd / safeFraction, 2),
    projectedKwh: round(summary.kwh / safeFraction, 3),
  };
}

export function projectedWithBase(
  summary: { costNzd: number; kwh: number },
  fraction: number,
  base: { elapsedCostNzd: number; elapsedKwh: number; fullCostNzd: number; fullKwh: number },
): PowerPeriodSummary {
  const safeFraction = Math.max(0.04, Math.min(1, fraction));
  return {
    costNzd: round(summary.costNzd + base.elapsedCostNzd, 2),
    kwh: round(summary.kwh + base.elapsedKwh, 3),
    projectedCostNzd: round(summary.costNzd / safeFraction + base.fullCostNzd, 2),
    projectedKwh: round(summary.kwh / safeFraction + base.fullKwh, 3),
  };
}

export function projectedYear(summary: { costNzd: number; kwh: number }, keys: ReturnType<typeof currentKeys>): PowerPeriodSummary {
  const weights = powerConfig().modeledBaseLoads.monthWeights;
  let elapsedWeight = 0;
  for (let i = 0; i < keys.month - 1; i += 1) {
    elapsedWeight += weights[i];
  }
  elapsedWeight += weights[keys.month - 1] * keys.monthFraction;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const factor = totalWeight / Math.max(0.15, elapsedWeight);

  return {
    costNzd: round(summary.costNzd, 2),
    kwh: round(summary.kwh, 3),
    projectedCostNzd: round(summary.costNzd * factor, 2),
    projectedKwh: round(summary.kwh * factor, 3),
  };
}

export function hourlyGraph(state: PowerState, now: Date) {
  const cutoff = new Date(now.getTime() - 36 * 60 * 60_000);
  const cutoffKey = hourKeyFromParts(localParts(cutoff));
  return Object.entries(state.hourly)
    .filter(([key]) => key >= cutoffKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-36)
    .map(([key, bucket]) => ({
      costNzd: round(bucket.costNzd, 2),
      kwh: round(bucket.kwh, 3),
      label: key.slice(5).replace("T", " "),
    }));
}

export function rateGraph(state: PowerState) {
  const plan = tariff();
  // Each superseded series is plotted against the year it ran out, and the
  // current one against this year. The years used to be written into the code,
  // which meant the graph silently stopped extending after 2026.
  const series = plan
    ? [
        ...plan.historicalAnytimeCPerKwh.map((entry) => ({ year: entry.throughYear, rates: entry.cPerKwh })),
        { year: localParts(new Date()).year, rates: plan.anytimeCPerKwh },
      ]
    : [];
  const baseline = series.flatMap(({ year, rates }) =>
    rates.map((cPerKwh, index) => ({
      cPerKwh,
      label: `${year}-${(index + 1).toString().padStart(2, "0")}`,
    })),
  );
  const history = state.rateHistory.slice(-730).map((entry) => ({
    cPerKwh: entry.cPerKwh,
    label: entry.label,
  }));
  const byLabel = new Map(baseline.map((point) => [point.label, point]));
  for (const point of history) {
    byLabel.set(point.label, point);
  }
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function backgroundEstimates(accountUsage: PowerAccountUsagePoint[]): PowerBackgroundEstimatePoint[] {
  return accountUsage.flatMap((point) => {
    const month = monthFromLabel(point.label);
    if (!month) {
      return [];
    }

    const days = point.days ?? daysInMonth(month.year, month.monthIndex);
    const dailyBase = modeledDailyBaseKwh(month.year, month.monthIndex);
    const fridgeKwh = round(dailyBase.fridgeKwh * days, 1);
    const waterHeaterKwh = round(dailyBase.waterHeaterKwh * days, 1);
    const computerKwh = round(dailyBase.computerKwh * days, 1);
    const novaKwh = round(dailyBase.novaKwh * days, 1);
    const knownKwh = fridgeKwh + waterHeaterKwh + computerKwh + novaKwh;

    return [
      {
        computerKwh,
        fridgeKwh,
        label: point.label,
        novaKwh,
        otherKwh: round(Math.max(0, point.kwh - knownKwh), 1),
        totalKwh: point.kwh,
        waterHeaterKwh,
      },
    ];
  });
}

export function pruneState(state: PowerState, now: Date) {
  const dailyCutoff = dateKeyFromParts(localParts(new Date(now.getTime() - 800 * 86_400_000)));
  for (const key of Object.keys(state.daily)) {
    if (key < dailyCutoff) {
      delete state.daily[key];
    }
  }

  const hourlyCutoff = hourKeyFromParts(localParts(new Date(now.getTime() - 45 * 86_400_000)));
  for (const key of Object.keys(state.hourly)) {
    if (key < hourlyCutoff) {
      delete state.hourly[key];
    }
  }

  state.rateHistory = state.rateHistory.slice(-760);

  if (state.floatingMeter) {
    pruneFloatingMeterState(
      state.floatingMeter,
      dateKeyFromParts(localParts(new Date(now.getTime() - FLOATING_METER_HISTORY_DAYS * 86_400_000))),
    );
  }
}
