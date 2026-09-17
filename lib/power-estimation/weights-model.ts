import type { ExpectedUsage, WeightedValue } from "./types";

export const POWERSHOP_ESTIMATE_HALF_LIFE_DAYS = 28;

export function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function dateAtNoon(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

export function addDays(dateKey: string, days: number) {
  const date = dateAtNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((dateAtNoon(to).getTime() - dateAtNoon(from).getTime()) / 86_400_000);
}

function weekday(dateKey: string) {
  return dateAtNoon(dateKey).getUTCDay();
}

function isWeekend(dateKey: string) {
  const day = weekday(dateKey);
  return day === 0 || day === 6;
}

export function similarityWeight(historyDate: string, targetDate: string) {
  if (weekday(historyDate) === weekday(targetDate)) {
    return 2.5;
  }
  if (isWeekend(historyDate) === isWeekend(targetDate)) {
    return 1.25;
  }
  return 1;
}

export function recencyWeight(historyDate: string, targetDate: string, today: string) {
  const ageDays = Math.max(1, daysBetween(historyDate, today));
  return 2 ** (-ageDays / POWERSHOP_ESTIMATE_HALF_LIFE_DAYS) * similarityWeight(historyDate, targetDate);
}

export function weightedMean(values: WeightedValue[], fallback: ExpectedUsage) {
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
