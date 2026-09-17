/**
 * Argument parsing, the date-key calendar and the overnight window.
 *
 * Moved verbatim from `scripts/powershop-daily-scrape.mjs`, which stays the
 * entry point (`node /app/scripts/powershop-daily-scrape.mjs`).
 */

import { DEFAULT_TIME_ZONE } from "./constants.mjs";

export function argValue(name) {
  const arg = process.argv.find((value) => value === name || value.startsWith(`${name}=`));
  if (!arg) {
    return null;
  }
  if (arg === name) {
    const index = process.argv.indexOf(arg);
    return process.argv[index + 1] ?? "";
  }
  return arg.slice(name.length + 1);
}

export function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((value) => value.startsWith(`${name}=`));
}

export function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function normalizeLoginCode(value) {
  if (typeof value !== "string") {
    return null;
  }
  const code = value.trim().replace(/\s+/g, "");
  return code ? code : null;
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function localParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    year: Number(parts.year),
  };
}

function dateKey(year, month, day) {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function addDaysToDateKey(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return dateKey(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()) === value;
}

export function dateKeysBetween(startDate, endDate) {
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    throw new Error(`Invalid Powershop date range: ${startDate} through ${endDate}`);
  }
  if (startDate > endDate) {
    throw new Error(`Powershop start date ${startDate} is after end date ${endDate}`);
  }
  const dates = [];
  for (let current = startDate; current <= endDate; current = addDaysToDateKey(current, 1)) {
    dates.push(current);
  }
  return dates;
}

export function summarizeRangeResults(records, failedDates, startDate, endDate, total) {
  const partialDates = records
    .filter((record) => record.status !== "ok")
    .map((record) => record.targetDate);
  return {
    completed: records.length,
    endDate,
    failed: failedDates.length,
    failedDates,
    partial: partialDates.length,
    partialDates,
    startDate,
    status: failedDates.length || partialDates.length ? "range_partial" : "range_ok",
    total,
  };
}

export function yesterdayKey(timeZone = DEFAULT_TIME_ZONE) {
  const parts = localParts(new Date(), timeZone);
  const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - 1);
  return dateKey(noonUtc.getUTCFullYear(), noonUtc.getUTCMonth() + 1, noonUtc.getUTCDate());
}

function minutesFromClock(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

export function isOvernight(template, now = new Date()) {
  const zone = template.timezone ?? DEFAULT_TIME_ZONE;
  const parts = localParts(now, zone);
  const current = parts.hour * 60 + parts.minute;
  const start = minutesFromClock(template.overnightWindow?.start ?? "00:00");
  const end = minutesFromClock(template.overnightWindow?.end ?? "06:30");
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}
