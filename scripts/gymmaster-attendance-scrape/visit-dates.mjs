/**
 * Parsing visit timestamps out of free text, in the portal's time zone.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import { DEFAULT_TIME_ZONE, MONTHS } from "./constants.mjs";

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) {
    return NaN;
  }
  return year < 100 ? 2000 + year : year;
}

function parseTime(hourRaw, minuteRaw, secondRaw, meridiemRaw) {
  if (hourRaw === undefined || hourRaw === null || hourRaw === "") {
    return { hasTime: false, hour: 12, minute: 0, second: 0 };
  }

  let hour = Number(hourRaw);
  const minute = Number(minuteRaw ?? 0);
  const second = Number(secondRaw ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return null;
  }

  const meridiem = String(meridiemRaw ?? "").replace(/\./g, "").toLowerCase();
  if (meridiem.startsWith("p") && hour < 12) {
    hour += 12;
  }
  if (meridiem.startsWith("a") && hour === 12) {
    hour = 0;
  }

  return { hasTime: true, hour, minute, second };
}

function timeZoneOffsetMs(date, timeZone) {
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
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ) - date.getTime();
}

function zonedDateToUtc(year, month, day, hour, minute, second, timeZone) {
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
    || second < 0
    || second > 59
  ) {
    return null;
  }

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = localAsUtc - timeZoneOffsetMs(new Date(localAsUtc), timeZone);
  result = localAsUtc - timeZoneOffsetMs(new Date(result), timeZone);
  const date = new Date(result);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addCandidate(candidates, date, source, raw, confidence, now) {
  if (!date) {
    return;
  }
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) {
    return;
  }
  if (epochMs < Date.UTC(2010, 0, 1) || epochMs > now.getTime() + 6 * 60 * 60 * 1000) {
    return;
  }

  const normalizedRaw = normalizeWhitespace(raw).slice(0, 140);
  if (candidates.some((candidate) => candidate.epochMs === epochMs && candidate.raw === normalizedRaw)) {
    return;
  }

  candidates.push({
    confidence,
    epochMs,
    iso: date.toISOString(),
    raw: normalizedRaw,
    source,
  });
}

function addDatePartsCandidate(candidates, parts, source, raw, confidence, options) {
  const time = parseTime(parts.hour, parts.minute, parts.second, parts.meridiem);
  if (!time) {
    return;
  }
  const date = zonedDateToUtc(
    normalizeYear(parts.year),
    Number(parts.month),
    Number(parts.day),
    time.hour,
    time.minute,
    time.second,
    options.timeZone,
  );
  addCandidate(candidates, date, source, raw, time.hasTime ? confidence : confidence - 0.15, options.now);
}

export function extractVisitCandidatesFromText(text, {
  now = new Date(),
  source = "text",
  timeZone = DEFAULT_TIME_ZONE,
} = {}) {
  const candidates = [];
  const input = normalizeWhitespace(text);
  const options = { now, timeZone };
  const separator = String.raw`(?:[\s,\u00a0]+(?:at\s+)?)?`;
  const optionalTime = String.raw`(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?`;

  const isoPattern = new RegExp(String.raw`\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b${separator}${optionalTime}`, "gi");
  for (const match of input.matchAll(isoPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[3],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: match[2],
        second: match[6],
        year: match[1],
      },
      source,
      match[0],
      0.82,
      options,
    );
  }

  const dmyPattern = new RegExp(String.raw`\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|\d{2})\b${separator}${optionalTime}`, "gi");
  for (const match of input.matchAll(dmyPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[1],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: match[2],
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.84,
      options,
    );
  }

  const monthPattern = new RegExp(
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${[...MONTHS.keys()].join("|")})\s+(20\d{2}|\d{2})\b${separator}${optionalTime}`,
    "gi",
  );
  for (const match of input.matchAll(monthPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[1],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: MONTHS.get(match[2].toLowerCase()),
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.86,
      options,
    );
  }

  const monthFirstPattern = new RegExp(
    String.raw`\b(${[...MONTHS.keys()].join("|")})\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2}|\d{2})\b${separator}${optionalTime}`,
    "gi",
  );
  for (const match of input.matchAll(monthFirstPattern)) {
    addDatePartsCandidate(
      candidates,
      {
        day: match[2],
        hour: match[4],
        meridiem: match[7],
        minute: match[5],
        month: MONTHS.get(match[1].toLowerCase()),
        second: match[6],
        year: match[3],
      },
      source,
      match[0],
      0.78,
      options,
    );
  }

  return candidates;
}
