import type { DoorbellSchedule } from "./types";

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/**
 * Local wall-clock parts for an instant in a named IANA zone.
 *
 * Uses Intl rather than manual offset arithmetic so DST transitions are
 * handled by the platform's tz database — Pacific/Auckland shifts twice a year
 * and a hand-rolled offset would silently grant or deny an hour of access.
 */
export function localPartsInZone(at: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-NZ", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: weekdays.indexOf(String(parts.weekday).slice(0, 3)),
    minutes: hour * 60 + Number(parts.minute),
  };
}

/** Is `at` inside any window of the given schedules, in the configured zone? */
export function isWithinSchedule(
  at: Date,
  timezone: string,
  schedules: DoorbellSchedule[],
): boolean {
  if (schedules.length === 0) {
    return false;
  }
  let local;
  try {
    local = localPartsInZone(at, timezone);
  } catch {
    // An unusable time zone means we cannot know whether access is allowed,
    // and "cannot know" must resolve to "no".
    return false;
  }
  if (local.dayOfWeek < 0) {
    return false;
  }

  for (const schedule of schedules) {
    if (schedule.denyDates.includes(local.isoDate)) {
      continue;
    }
    for (const window of schedule.windows) {
      const start = minutesOfDay(window.start);
      const end = minutesOfDay(window.end);
      if (start === null || end === null) {
        continue;
      }
      if (start <= end) {
        if (
          schedule.windows.length > 0
          && window.daysOfWeek.includes(local.dayOfWeek)
          && local.minutes >= start
          && local.minutes < end
        ) {
          return true;
        }
      } else {
        // Crosses midnight: the window belongs to the day it started on, so
        // the small hours match the *previous* day's entry.
        const previousDay = (local.dayOfWeek + 6) % 7;
        if (window.daysOfWeek.includes(local.dayOfWeek) && local.minutes >= start) {
          return true;
        }
        if (window.daysOfWeek.includes(previousDay) && local.minutes < end) {
          return true;
        }
      }
    }
  }
  return false;
}
