// Assembles the PowerDashboard payload from state, readings and account usage.
import type { PowerAccountUsagePoint } from "../config-schema";
import { calibratePowershopEstimates } from "../power-estimation";
import type { PowershopAccountMetadata, PowershopDailyUsageRecord } from "../powershop-usage";
import type { WashingMachineState } from "../washing-machine";
import {
  backgroundEstimates,
  hourlyGraph,
  projectedWithBase,
  projectedYear,
  rateGraph,
  sumBuckets,
} from "./aggregate";
import { modeledBaseYear, modeledCurrentBaseLoad } from "./base-load";
import { currentKeys, localParts } from "./calendar";
import { suppressedBaseLoadIds } from "./floating-meter";
import { buildFloatingMeterSummary } from "./meters";
import { round } from "./numbers";
import { currentRate } from "./tariff";
import type { PowerDashboard, PowerDeviceReading, PowerState } from "./types";
import { buildWashingMachineSummary } from "./washing";

export function buildDashboard(
  state: PowerState,
  readings: PowerDeviceReading[],
  accountUsage: PowerAccountUsagePoint[],
  dailyUsage: PowershopDailyUsageRecord[],
  accountMetadata: PowershopAccountMetadata | null,
  now: Date,
  washing: WashingMachineState | null = null,
): PowerDashboard {
  const keys = currentKeys(now, accountMetadata?.billing);
  const rate = currentRate(now);
  const day = state.daily[keys.today] ?? { costNzd: 0, kwh: 0 };
  const ytd = sumBuckets(state, keys.yearStart, keys.today);
  const floatingMeter = buildFloatingMeterSummary(state.floatingMeter, now);
  const washingMachine = buildWashingMachineSummary(washing, now);
  const baseLoad = modeledCurrentBaseLoad(
    now,
    rate,
    keys,
    suppressedBaseLoadIds(floatingMeter?.categories ?? []),
  );
  const monitoredWatts = readings.reduce((sum, reading) => sum + reading.watts, 0);
  const fallbackCurrentWatts = monitoredWatts + baseLoad.currentWatts;
  const totalKwh = Object.values(state.devices).reduce((sum, device) => sum + device.kwhTotal, 0);
  const totalCost = Object.values(state.daily).reduce((sum, bucket) => sum + bucket.costNzd, 0);
  const dayBase = {
    elapsedCostNzd: baseLoad.elapsedCostNzd,
    elapsedKwh: baseLoad.elapsedKwh,
    fullCostNzd: baseLoad.costPerDayNzd,
    fullKwh: baseLoad.kwhPerDay,
  };
  const yearBase = modeledBaseYear(keys);
  const connectedYearProjection = projectedYear(ytd, keys);
  const fallbackDay = projectedWithBase(day, keys.dayFraction, dayBase);
  const currentUsageRateCents = rate.touCPerKwh || rate.cPerKwh;
  const calibrated = calibratePowershopEstimates(dailyUsage, {
    billingEndDate: keys.billingEnd,
    billingStartDate: keys.billingStart,
    currentUsageRateCents,
    fallbackCurrentCostPerHourNzd:
      (fallbackCurrentWatts / 1000) * (currentUsageRateCents / 100) + rate.dailyCents / 100 / 24,
    fallbackCurrentWatts,
    fallbackDailyCostNzd: fallbackDay.projectedCostNzd ?? baseLoad.costPerDayNzd,
    fallbackDailyKwh: fallbackDay.projectedKwh ?? baseLoad.kwhPerDay,
    localElapsedCostNzd: day.costNzd + baseLoad.elapsedCostNzd,
    localElapsedKwh: day.kwh + baseLoad.elapsedKwh,
    nowHour: localParts(now).hour + localParts(now).minute / 60 + localParts(now).second / 3600,
    today: keys.today,
    weekStartDate: keys.weekStart,
  });
  const currentWatts = calibrated.currentWatts;

  return {
    baseLoad,
    ...(floatingMeter ? { floatingMeter } : {}),
    ...(washingMachine ? { washingMachine } : {}),
    billingCycle: {
      day: Math.min(keys.billingDays, Math.floor(keys.billingElapsedDays) + 1),
      days: keys.billingDays,
      endDate: keys.billingEnd,
      label: keys.billingLabel,
      startDate: keys.billingStart,
    },
    currentCostPerHourNzd: calibrated.currentCostPerHourNzd,
    currentRate: {
      cPerKwh: calibrated.currentUsageRateCents,
      dailyCents: rate.dailyCents,
      displayName: rate.displayName,
      period: rate.period,
      sourceUrl: rate.sourceUrl,
    },
    currentWatts: round(currentWatts, 1),
    devices: readings.sort((a, b) => b.watts - a.watts || a.name.localeCompare(b.name)),
    estimation: calibrated.calibration,
    generatedAt: now.toISOString(),
    graph: hourlyGraph(state, now),
    accountUsageGraph: accountUsage,
    accountRateGraph: accountUsage
      .filter((point) => Number.isFinite(Number(point.avgUnitCents)))
      .map((point) => ({ cPerKwh: round(Number(point.avgUnitCents), 2), label: point.label })),
    backgroundEstimateGraph: backgroundEstimates(accountUsage),
    lastRateCheckAt: state.lastRateCheck?.checkedAt ?? null,
    lastSampleAt: state.lastSampleAt,
    rateGraph: rateGraph(state),
    ratesWarning: state.lastRateCheck?.warning,
    summaries: {
      day: calibrated.day,
      week: calibrated.week,
      month: calibrated.month,
      yearToDate: {
        costNzd: round(ytd.costNzd + yearBase.elapsedCostNzd, 2),
        kwh: round(ytd.kwh + yearBase.elapsedKwh, 3),
        projectedCostNzd: round((connectedYearProjection.projectedCostNzd ?? 0) + yearBase.fullCostNzd, 2),
        projectedKwh: round((connectedYearProjection.projectedKwh ?? 0) + yearBase.fullKwh, 3),
      },
    },
    totals: {
      costNzd: round(totalCost, 2),
      kwh: round(totalKwh, 3),
    },
  };
}
