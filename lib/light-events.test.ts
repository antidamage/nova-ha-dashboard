import { describe, expect, it } from "vitest";
import { dueOccurrence, eventTurnsLightsOff, LIGHT_EVENT_GRACE_MS } from "./light-events";
import type { SunStatus, ZoneLightEvent } from "./types";

function event(overrides: Partial<ZoneLightEvent> = {}): ZoneLightEvent {
  return {
    id: "evt-1",
    zoneId: "lounge",
    enabled: true,
    at: { kind: "clock", hhmm: "18:00" },
    days: [],
    value: { hue: 30, saturation: 60, brightnessPct: 60 },
    ...overrides,
  };
}

/** A local time on a known weekday: 2026-09-14 was a Monday. */
function at(hours: number, minutes = 0, day = 14) {
  return new Date(2026, 8, day, hours, minutes, 0, 0);
}

describe("dueOccurrence", () => {
  it("fires once the clock time has passed, within the grace window", () => {
    expect(dueOccurrence(event(), at(18, 1))).not.toBeNull();
  });

  it("does not fire before its time", () => {
    expect(dueOccurrence(event(), at(17, 59))).toBeNull();
  });

  it("skips an occurrence missed by more than the grace window", () => {
    expect(dueOccurrence(event(), at(18, 6))).toBeNull();
    expect(LIGHT_EVENT_GRACE_MS).toBe(5 * 60 * 1000);
  });

  it("does not fire twice for the same occurrence", () => {
    const now = at(18, 2);
    const first = dueOccurrence(event(), now);
    expect(first).not.toBeNull();
    expect(dueOccurrence(event(), now, { lastFiredIso: first!.toISOString() })).toBeNull();
  });

  it("fires again the next day", () => {
    const yesterday = at(18, 1, 13).toISOString();
    expect(dueOccurrence(event(), at(18, 1), { lastFiredIso: yesterday })).not.toBeNull();
  });

  it("honours the weekday filter", () => {
    // 2026-09-14 is a Monday (day 1).
    expect(dueOccurrence(event({ days: [1] }), at(18, 1))).not.toBeNull();
    expect(dueOccurrence(event({ days: [2, 3] }), at(18, 1))).toBeNull();
  });

  it("stays quiet while disabled", () => {
    expect(dueOccurrence(event({ enabled: false }), at(18, 1))).toBeNull();
  });

  it("applies a sunset offset", () => {
    const sun: SunStatus = {
      entity_id: "sun.sun",
      state: "above_horizon",
      nextRising: null,
      // Sunset already happened 2 minutes ago today; HA publishes tomorrow's.
      nextSetting: at(18, 0, 15).toISOString(),
    };
    const sunsetEvent = event({ at: { kind: "sun", event: "sunset", offsetMinutes: 0 } });
    // Today's sunset is a day before the published next one.
    expect(dueOccurrence(sunsetEvent, at(18, 2), { sun })).not.toBeNull();
    expect(dueOccurrence(sunsetEvent, at(17, 50), { sun })).toBeNull();
  });

  it("reads zero brightness as off", () => {
    expect(eventTurnsLightsOff(event({ value: { hue: 0, saturation: 0, brightnessPct: 0 } }))).toBe(true);
    expect(eventTurnsLightsOff(event())).toBe(false);
  });
});
