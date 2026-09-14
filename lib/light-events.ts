import type { SunStatus, ZoneLightEvent } from "./types";

/**
 * When a zone light event is due, and what it sets. The host poller owns the
 * firing; everything here is pure so it can be tested without Home Assistant.
 * See specs/zone-light-events.md.
 */

/** An occurrence missed by more than this is skipped rather than fired late. */
export const LIGHT_EVENT_GRACE_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The sun times Home Assistant publishes are the *next* rising and setting, so
 * today's occurrence is that timestamp when it is still ahead of us and the
 * same clock time a day earlier once it has passed.
 */
function sunOccurrence(event: "sunrise" | "sunset", sun: SunStatus | null | undefined, now: Date): Date | null {
  const iso = event === "sunrise" ? sun?.nextRising : sun?.nextSetting;
  if (!iso) return null;
  const next = new Date(iso);
  if (Number.isNaN(next.getTime())) return null;
  if (next.getTime() <= now.getTime()) return next;
  const previous = new Date(next.getTime() - DAY_MS);
  return previous.getTime() <= now.getTime() ? previous : next;
}

function clockOccurrence(hhmm: string, now: Date): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return null;
  const at = new Date(now);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return at;
}

/** The most recent occurrence of this event at or before `now`, if any. */
export function lastOccurrence(
  event: ZoneLightEvent,
  now: Date,
  sun?: SunStatus | null,
): Date | null {
  const at = event.at.kind === "clock"
    ? clockOccurrence(event.at.hhmm, now)
    : sunOccurrence(event.at.event, sun, now);
  if (!at) return null;
  if (at.getTime() > now.getTime()) {
    // Today's clock time is still ahead; the last one was yesterday.
    return event.at.kind === "clock" ? new Date(at.getTime() - DAY_MS) : null;
  }
  return at;
}

function dayAllowed(event: ZoneLightEvent, at: Date): boolean {
  return event.days.length === 0 || event.days.includes(at.getDay());
}

/**
 * The occurrence this event should fire for now, or null. An occurrence is due
 * when it has passed, its weekday is allowed, it is no more than
 * `LIGHT_EVENT_GRACE_MS` old, and it is not the one already recorded as fired.
 */
export function dueOccurrence(
  event: ZoneLightEvent,
  now: Date,
  options: { lastFiredIso?: string | null; sun?: SunStatus | null; graceMs?: number } = {},
): Date | null {
  if (!event.enabled) return null;
  const at = lastOccurrence(event, now, options.sun);
  if (!at || !dayAllowed(event, at)) return null;

  const age = now.getTime() - at.getTime();
  if (age < 0 || age > (options.graceMs ?? LIGHT_EVENT_GRACE_MS)) return null;

  if (options.lastFiredIso) {
    const lastFired = new Date(options.lastFiredIso);
    if (!Number.isNaN(lastFired.getTime()) && lastFired.getTime() >= at.getTime()) return null;
  }
  return at;
}

/** Zero brightness is off; anything above it is on at that level. */
export function eventTurnsLightsOff(event: ZoneLightEvent): boolean {
  return event.value.brightnessPct <= 0;
}
