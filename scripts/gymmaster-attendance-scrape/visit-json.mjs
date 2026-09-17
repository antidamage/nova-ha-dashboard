/**
 * Walking a JSON payload for visit timestamps, and picking the latest.
 *
 * Moved verbatim from `scripts/gymmaster-attendance-scrape.mjs`, which stays
 * the entry point (`node /app/scripts/gymmaster-attendance-scrape.mjs`).
 */

import { DEFAULT_TIME_ZONE } from "./constants.mjs";
import { extractVisitCandidatesFromText } from "./visit-dates.mjs";

function jsonPathLooksRelevant(pathParts) {
  const pathText = pathParts.join(".").toLowerCase();
  return /\b(visit|check.?in|access|attendance|history|date|time|timestamp)\b/.test(pathText);
}

export function extractVisitCandidatesFromJson(value, {
  now = new Date(),
  source = "json",
  timeZone = DEFAULT_TIME_ZONE,
} = {}, pathParts = []) {
  const candidates = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      candidates.push(...extractVisitCandidatesFromJson(item, { now, source, timeZone }, [...pathParts, String(index)]));
    });
    return candidates;
  }

  if (!value || typeof value !== "object") {
    if ((typeof value === "string" || typeof value === "number") && jsonPathLooksRelevant(pathParts)) {
      candidates.push(...extractVisitCandidatesFromText(String(value), {
        now,
        source: `${source}:${pathParts.join(".")}`.slice(0, 120),
        timeZone,
      }));
    }
    return candidates;
  }

  const record = value;
  const entries = Object.entries(record);
  const dateEntry = entries.find(([key]) => /\b(date|day|visitdate|visit_date|checkindate|checkin_date)\b/i.test(key));
  const timeEntry = entries.find(([key]) => /\b(time|visittime|visit_time|checkintime|checkin_time)\b/i.test(key));
  if (dateEntry && timeEntry) {
    candidates.push(...extractVisitCandidatesFromText(`${dateEntry[1]} ${timeEntry[1]}`, {
      now,
      source: `${source}:${[...pathParts, dateEntry[0], timeEntry[0]].join(".")}`.slice(0, 120),
      timeZone,
    }));
  }

  for (const [key, child] of entries) {
    candidates.push(...extractVisitCandidatesFromJson(child, { now, source, timeZone }, [...pathParts, key]));
  }
  return candidates;
}

export function pickLatestVisitCandidate(candidates) {
  return candidates
    .filter((candidate) => Number.isFinite(candidate.epochMs))
    .sort((a, b) => b.epochMs - a.epochMs || b.confidence - a.confidence)[0] ?? null;
}

export function localDateKey(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-NZ", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
