// Date handling: the household's zone, wall-clock to UTC, recurrence
// stepping and the day keys the mirror matches on.
import { readDashboardConfigSync } from "../dashboard-config";
import type { IcalTime } from "./types";

/**
 * The timezone this installation lives in. Falls back to the host's own zone if
 * config cannot be read, which is still a better guess than any fixed city.
 */
function householdTimeZone() {
  try {
    return readDashboardConfigSync().power.timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function occurrenceDateFromTime(time: IcalTime) {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

export function zonedDateToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  // The household's own zone, from power.timeZone. Reminder times are wall-clock
  // times in the home, so they must resolve against the home's zone rather than
  // the server's — and certainly not against one city written into the product.
  timeZone = householdTimeZone(),
) {
  let utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });

  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(utcDate).map((part) => [part.type, part.value]));
    const actualUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    const nextUtcDate = new Date(utcDate.getTime() + (targetUtcMs - actualUtcMs));
    if (Math.abs(nextUtcDate.getTime() - utcDate.getTime()) < 1000) {
      return nextUtcDate;
    }
    utcDate = nextUtcDate;
  }

  return utcDate;
}

export function withinWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  return start.getTime() < windowEnd.getTime() && end.getTime() > windowStart.getTime();
}

function addMonthsPreservingDay(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function nextRecurringDate(start: Date, ruleValue: unknown, windowStart: Date) {
  const rule = String(ruleValue ?? "");
  if (!rule || start.getTime() >= windowStart.getTime()) {
    return start;
  }

  const parts = Object.fromEntries(rule.split(";").map((part) => {
    const [key, value] = part.split("=");
    return [key?.toUpperCase(), value?.toUpperCase()];
  }));
  const interval = Math.max(1, Math.round(Number(parts.INTERVAL ?? 1)) || 1);
  let next = new Date(start);
  let safety = 0;

  while (next.getTime() < windowStart.getTime() && safety < 2000) {
    safety += 1;
    if (parts.FREQ === "DAILY") {
      next = new Date(next.getTime() + interval * 24 * 60 * 60 * 1000);
    } else if (parts.FREQ === "WEEKLY") {
      next = new Date(next.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
    } else if (parts.FREQ === "MONTHLY") {
      next = addMonthsPreservingDay(next, interval);
    } else if (parts.FREQ === "YEARLY") {
      next = addMonthsPreservingDay(next, interval * 12);
    } else {
      return start;
    }
  }

  return next;
}

export function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "2-digit",
    timeZone: householdTimeZone(),
    year: "numeric",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}
