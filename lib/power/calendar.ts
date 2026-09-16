// Local-time keys and billing periods, in `power.timeZone`.
import type { PowershopAccountMetadata } from "../powershop-usage";
import { localFormatter, powerConfig } from "./store";

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function localParts(date: Date) {
  const parts = Object.fromEntries(localFormatter().formatToParts(date).map((part) => [part.type, part.value]));
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    weekday: String(parts.weekday),
    year: Number(parts.year),
  };
}

export function dateKeyFromParts(parts: ReturnType<typeof localParts>) {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day
    .toString()
    .padStart(2, "0")}`;
}

export function hourKeyFromParts(parts: ReturnType<typeof localParts>) {
  return `${dateKeyFromParts(parts)}T${parts.hour.toString().padStart(2, "0")}`;
}

function dateKeyFromUtc(date: Date) {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

export function monthFromLabel(label: string) {
  const [monthName, yearText] = label.split(/\s+/);
  const monthIndex = monthNames.indexOf(monthName);
  const year = Number(yearText);
  if (monthIndex < 0 || !Number.isFinite(year)) {
    return null;
  }
  return { monthIndex, year };
}

export function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function billingCycleFor(
  parts: ReturnType<typeof localParts>,
  localUtc: Date,
  dayFraction: number,
  powershopBilling?: PowershopAccountMetadata["billing"],
) {
  const billingConfig = powerConfig().billing;
  const metadataApplies =
    powershopBilling &&
    dateKeyFromUtc(localUtc) >= powershopBilling.currentPeriodStartDate &&
    dateKeyFromUtc(localUtc) <= powershopBilling.currentPeriodEndDate;
  const billingEndDay = metadataApplies
    ? Number(powershopBilling.currentPeriodEndDate.slice(8, 10))
    : billingConfig.endDay;
  const billingStartDay = metadataApplies
    ? Number(powershopBilling.currentPeriodStartDate.slice(8, 10))
    : billingConfig.startDay;
  const billingEnd = metadataApplies
    ? new Date(`${powershopBilling.currentPeriodEndDate}T00:00:00Z`)
    : new Date(Date.UTC(parts.year, parts.month - 1 + (parts.day > billingEndDay ? 1 : 0), billingEndDay));
  const billingStart = metadataApplies
    ? new Date(`${powershopBilling.currentPeriodStartDate}T00:00:00Z`)
    : new Date(Date.UTC(billingEnd.getUTCFullYear(), billingEnd.getUTCMonth() - 1, billingStartDay));
  const billingDays = Math.round((billingEnd.getTime() - billingStart.getTime()) / 86_400_000) + 1;
  const billingElapsedDays = Math.max(
    0,
    Math.min(billingDays, (localUtc.getTime() - billingStart.getTime()) / 86_400_000 + dayFraction),
  );

  return {
    billingDays,
    billingElapsedDays,
    billingEnd,
    billingEndKey: dateKeyFromUtc(billingEnd),
    billingFraction: billingElapsedDays / billingDays,
    billingLabel: `${monthNames[billingEnd.getUTCMonth()]} ${billingEnd.getUTCFullYear()}`,
    billingStart,
    billingStartKey: dateKeyFromUtc(billingStart),
  };
}

export function currentKeys(date: Date, powershopBilling?: PowershopAccountMetadata["billing"]) {
  const parts = localParts(date);
  const dateKey = dateKeyFromParts(parts);
  const weekdayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
  const localUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekStart = new Date(localUtc);
  weekStart.setUTCDate(localUtc.getUTCDate() - Math.max(0, weekdayIndex));
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const yearStart = new Date(Date.UTC(parts.year, 0, 1));
  const dayOfYear = Math.floor((localUtc.getTime() - yearStart.getTime()) / 86_400_000) + 1;
  const daysInYear = new Date(Date.UTC(parts.year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  const dayFraction = (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86_400;
  const billing = billingCycleFor(parts, localUtc, dayFraction, powershopBilling);

  return {
    billingDays: billing.billingDays,
    billingElapsedDays: billing.billingElapsedDays,
    billingEnd: billing.billingEndKey,
    billingEndUtc: billing.billingEnd,
    billingFraction: billing.billingFraction,
    billingLabel: billing.billingLabel,
    billingStart: billing.billingStartKey,
    billingStartUtc: billing.billingStart,
    dateKey,
    day: parts.day,
    dayFraction,
    daysInMonth,
    daysInYear,
    hourKey: hourKeyFromParts(parts),
    month: parts.month,
    monthFraction: ((parts.day - 1) + dayFraction) / daysInMonth,
    monthStart: `${parts.year}-${parts.month.toString().padStart(2, "0")}-01`,
    today: dateKey,
    weekFraction: ((weekdayIndex < 0 ? 0 : weekdayIndex) + dayFraction) / 7,
    weekStart: dateKeyFromUtc(weekStart),
    year: parts.year,
    yearDay: dayOfYear,
    yearFraction: ((dayOfYear - 1) + dayFraction) / daysInYear,
    yearStart: `${parts.year}-01-01`,
  };
}

export function localMonthKey(date: Date) {
  const parts = localParts(date);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}`;
}

/** Epoch ms at which a local `YYYY-MM-DDTHH` hour bucket ends, in power.timeZone. */
export function localHourEndMs(hourKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(hourKey);
  if (!match) return NaN;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]));
  let utc = wall;
  // Two passes settle the offset either side of a daylight-saving change.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = localParts(new Date(utc));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24);
    utc -= shown - wall;
  }
  return utc + 3_600_000;
}
