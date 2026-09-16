// The modelled always-on loads: fridges, water heater, desktop, Nova.
import { currentKeys, daysInMonth, localParts } from "./calendar";
import { round } from "./numbers";
import { powerConfig } from "./store";
import { currentRate, rateCentsForMonth, tariff } from "./tariff";
import type { PowerBaseLoadSummary, PowerModeledLoad } from "./types";

function averageFridgeKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.monthlyOutdoorTempsC[monthIndex];
  return 1.15 + Math.max(0, averageTemp - 12) * 0.035;
}

function averageWaterHeaterKwhPerDay(monthIndex: number) {
  const averageTemp = powerConfig().modeledBaseLoads.monthlyOutdoorTempsC[monthIndex];
  return 6.3 + Math.max(0, 17 - averageTemp) * 0.45;
}

function desktopActiveHoursPerDay() {
  const modeled = powerConfig().modeledBaseLoads;
  return modeled.desktopActiveEndHour - modeled.desktopActiveStartHour;
}

function desktopDailyKwh() {
  const modeled = powerConfig().modeledBaseLoads;
  const activeHours = desktopActiveHoursPerDay();
  return (modeled.desktopActiveWatts * activeHours + modeled.desktopStandbyWatts * (24 - activeHours)) / 1000;
}

function desktopActiveHoursElapsed(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  return Math.max(0, Math.min(hourOfDay, modeled.desktopActiveEndHour) - modeled.desktopActiveStartHour);
}

function desktopKwhElapsed(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  const activeHours = desktopActiveHoursElapsed(hourOfDay);
  return (modeled.desktopActiveWatts * activeHours + modeled.desktopStandbyWatts * Math.max(0, hourOfDay - activeHours)) / 1000;
}

function desktopCurrentWatts(hourOfDay: number) {
  const modeled = powerConfig().modeledBaseLoads;
  return hourOfDay >= modeled.desktopActiveStartHour && hourOfDay < modeled.desktopActiveEndHour
    ? modeled.desktopActiveWatts
    : modeled.desktopStandbyWatts;
}

function novaDailyKwh() {
  return (powerConfig().modeledBaseLoads.novaAioAverageWatts * 24) / 1000;
}

export function modeledDailyBaseKwh(year: number, monthIndex: number) {
  const fridgeKwh = averageFridgeKwhPerDay(monthIndex);
  const waterHeaterKwh = averageWaterHeaterKwhPerDay(monthIndex);
  const computerKwh = desktopDailyKwh();
  const novaKwh = novaDailyKwh();
  return {
    computerKwh,
    fridgeKwh,
    novaKwh,
    totalKwh: fridgeKwh + waterHeaterKwh + computerKwh + novaKwh,
    waterHeaterKwh,
    year,
  };
}

function modeledBaseCost(kwh: number, days: number, year: number, monthIndex: number) {
  return kwh * (rateCentsForMonth(year, monthIndex) / 100) + days * ((tariff()?.dailyCents ?? 0) / 100);
}

function modeledBasePeriod(year: number, monthIndex: number, elapsedDays: number, fullDays: number) {
  const daily = modeledDailyBaseKwh(year, monthIndex);
  const elapsedKwh = daily.totalKwh * elapsedDays;
  const fullKwh = daily.totalKwh * fullDays;
  return {
    elapsedCostNzd: modeledBaseCost(elapsedKwh, elapsedDays, year, monthIndex),
    elapsedKwh,
    fullCostNzd: modeledBaseCost(fullKwh, fullDays, year, monthIndex),
    fullKwh,
  };
}

function modeledBaseRange(startUtc: Date, days: number) {
  let remainingDays = Math.max(0, days);
  let cursor = new Date(startUtc.getTime());
  let costNzd = 0;
  let kwh = 0;

  while (remainingDays > 0.000001) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
    const daysUntilNextMonth = Math.max(0.000001, (nextMonth.getTime() - cursor.getTime()) / 86_400_000);
    const segmentDays = Math.min(remainingDays, daysUntilNextMonth);
    const daily = modeledDailyBaseKwh(year, monthIndex);
    const segmentKwh = daily.totalKwh * segmentDays;
    kwh += segmentKwh;
    costNzd += modeledBaseCost(segmentKwh, segmentDays, year, monthIndex);
    remainingDays -= segmentDays;
    cursor = new Date(cursor.getTime() + segmentDays * 86_400_000);
  }

  return { costNzd, kwh };
}

function modeledBaseBillingCycle(keys: ReturnType<typeof currentKeys>) {
  const elapsed = modeledBaseRange(keys.billingStartUtc, keys.billingElapsedDays);
  const full = modeledBaseRange(keys.billingStartUtc, keys.billingDays);
  return {
    elapsedCostNzd: elapsed.costNzd,
    elapsedKwh: elapsed.kwh,
    fullCostNzd: full.costNzd,
    fullKwh: full.kwh,
  };
}

export function modeledBaseYear(keys: ReturnType<typeof currentKeys>) {
  let elapsedCostNzd = 0;
  let elapsedKwh = 0;
  let fullCostNzd = 0;
  let fullKwh = 0;
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const fullDays = daysInMonth(keys.year, monthIndex);
    const elapsedDays =
      monthIndex < keys.month - 1 ? fullDays : monthIndex === keys.month - 1 ? keys.day - 1 + keys.dayFraction : 0;
    const period = modeledBasePeriod(keys.year, monthIndex, elapsedDays, fullDays);
    elapsedCostNzd += period.elapsedCostNzd;
    elapsedKwh += period.elapsedKwh;
    fullCostNzd += period.fullCostNzd;
    fullKwh += period.fullKwh;
  }
  return { elapsedCostNzd, elapsedKwh, fullCostNzd, fullKwh };
}

/**
 * The modelled always-on loads.
 *
 * `suppressed` names the loads a floating-meter category now stands in for. A
 * category contributes whether it is measured or modelled, so withholding its
 * overlapping model in both states is what keeps the grid total from jumping
 * when the meter moves. See specs/power-meters.md §3.4.
 */
export function modeledCurrentBaseLoad(
  now: Date,
  rate: ReturnType<typeof currentRate>,
  keys: ReturnType<typeof currentKeys>,
  suppressed: Set<string> = new Set(),
): PowerBaseLoadSummary {
  const modeled = powerConfig().modeledBaseLoads;
  const parts = localParts(now);
  const hourOfDay = parts.hour + parts.minute / 60 + parts.second / 3600;
  const monthIndex = Math.max(0, Math.min(11, parts.month - 1));
  const daily = modeledDailyBaseKwh(parts.year, monthIndex);
  const fixedCostPerDayNzd = rate.dailyCents / 100;
  const fridgeElapsed = daily.fridgeKwh * keys.dayFraction;
  const waterHeaterElapsed = daily.waterHeaterKwh * keys.dayFraction;
  const computerElapsed = desktopKwhElapsed(hourOfDay);
  const novaElapsed = daily.novaKwh * keys.dayFraction;
  const fridgeWatts = (daily.fridgeKwh * 1000) / 24;
  const waterHeaterWatts = (daily.waterHeaterKwh * 1000) / 24;
  const computerWatts = desktopCurrentWatts(hourOfDay);

  const devices: PowerModeledLoad[] = [
    {
      costPerDayNzd: round(daily.fridgeKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(fridgeWatts, 1),
      elapsedCostNzd: round(fridgeElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(fridgeElapsed, 3),
      id: "fridges",
      kwhPerDay: round(daily.fridgeKwh, 3),
      name: "Fridges",
      notes: "Continuous compressor model with Auckland seasonal temperature weighting.",
    },
    {
      costPerDayNzd: round(daily.waterHeaterKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(waterHeaterWatts, 1),
      elapsedCostNzd: round(waterHeaterElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(waterHeaterElapsed, 3),
      id: "water_heater",
      kwhPerDay: round(daily.waterHeaterKwh, 3),
      name: "Water heater",
      notes: "Always-on thermal model, higher in cooler Auckland months.",
    },
    {
      costPerDayNzd: round(daily.computerKwh * (rate.cPerKwh / 100), 2),
      currentWatts: round(computerWatts, 1),
      elapsedCostNzd: round(computerElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(computerElapsed, 3),
      id: "desktop_pc",
      kwhPerDay: round(daily.computerKwh, 3),
      name: "Desktop PC",
      notes: "800W PSU treated as capacity; model assumes daytime active use and overnight standby.",
    },
    {
      costPerDayNzd: round(daily.novaKwh * (rate.cPerKwh / 100), 2),
      currentWatts: modeled.novaAioAverageWatts,
      elapsedCostNzd: round(novaElapsed * (rate.cPerKwh / 100), 2),
      elapsedKwh: round(novaElapsed, 3),
      id: "nova_aio",
      kwhPerDay: round(daily.novaKwh, 3),
      name: "Nova",
      notes: "Always-on ASUS Zen AiO class model, based on a 90W adapter with lower average draw.",
    },
  ];

  // Every total is recomputed from the surviving loads rather than from the
  // full model, so a suppressed load leaves no trace in the daily figure, the
  // elapsed figure, or the current watts.
  const kept = devices.filter((device) => !suppressed.has(device.id));
  const keptKwhPerDay = kept.reduce((sum, device) => sum + device.kwhPerDay, 0);
  const keptElapsedKwh = kept.reduce((sum, device) => sum + device.elapsedKwh, 0);
  const keptWatts = kept.reduce((sum, device) => sum + device.currentWatts, 0);
  const keptUsageCostPerDayNzd = keptKwhPerDay * (rate.cPerKwh / 100);
  const keptElapsedCostNzd = keptElapsedKwh * (rate.cPerKwh / 100) + fixedCostPerDayNzd * keys.dayFraction;

  return {
    costPerDayNzd: round(keptUsageCostPerDayNzd + fixedCostPerDayNzd, 2),
    currentWatts: round(keptWatts, 1),
    devices: kept,
    elapsedCostNzd: round(keptElapsedCostNzd, 2),
    elapsedKwh: round(keptElapsedKwh, 3),
    fixedCostPerDayNzd: round(fixedCostPerDayNzd, 2),
    kwhPerDay: round(keptKwhPerDay, 3),
    usageCostPerDayNzd: round(keptUsageCostPerDayNzd, 2),
  };
}
