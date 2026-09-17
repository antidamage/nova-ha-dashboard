import { describe, expect, it } from "vitest";
import { autonomousClimateInputIsUsable } from "../autonomous-climate-safety";
import {
  BEDROOM_HEATER_MIN_CYCLE_MS,
  BedroomHeaterThermostat,
  bedroomHeaterMode,
  roomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
  bedroomTemperatureStateIsUsable,
  bedroomHeaterSleepTimerExpired,
} from "../bedroom-heater-control";
import { PREFS, plan } from "./bedroom-heater-control.fixtures";

describe("room temperature authority", () => {
  it("trusts exactly the configured sensors, in order", () => {
    expect(roomTemperatureEntityIds(["sensor.study_room_temperature"])).toEqual([
      "sensor.study_room_temperature",
    ]);
    expect(
      roomTemperatureEntityIds(["sensor.study_room_temperature", "sensor.study_backup_temperature"]),
    ).toEqual(["sensor.study_room_temperature", "sensor.study_backup_temperature"]);
  });

  /**
   * The safety rule: with nothing configured, Auto must have no reading at all
   * rather than picking up whatever sensor happens to be nearby — notably the
   * heater plug's own body temperature, which is far too damped to be a room
   * reading and would let Auto keep heating an already-warm room.
   */
  it("trusts nothing when no sensor is configured, so Auto fails safe", () => {
    expect(roomTemperatureEntityIds([])).toEqual([]);
    expect(roomTemperatureEntityIds(["", "   "])).toEqual([]);
  });

  it("rejects a stale or undated reading", () => {
    const now = Date.parse("2026-08-09T21:30:00Z");
    expect(bedroomTemperatureStateIsFresh({ last_reported: "2026-08-09T21:15:00Z" }, now)).toBe(true);
    expect(bedroomTemperatureStateIsFresh({ last_reported: "2026-08-09T06:08:59Z" }, now)).toBe(false);
    expect(bedroomTemperatureStateIsFresh({
      attributes: { source_reported_at: "2026-08-09T06:08:59Z" },
      last_reported: "2026-08-09T21:29:59Z",
    }, now)).toBe(false);
    expect(bedroomTemperatureStateIsFresh({}, now)).toBe(false);
  });

  it("allows Auto only for a fresh numeric reading", () => {
    const now = Date.parse("2026-08-09T21:30:00Z");
    expect(bedroomTemperatureStateIsUsable({ state: "28", last_reported: "2026-08-09T21:15:00Z" }, now)).toBe(true);
    expect(bedroomTemperatureStateIsUsable({ state: "20", last_reported: "2026-08-09T06:08:59Z" }, now)).toBe(false);
    expect(bedroomTemperatureStateIsUsable({ state: "unavailable", last_reported: "2026-08-09T21:29:00Z" }, now)).toBe(false);
  });
});

describe("autonomous climate golden rule", () => {
  it("requires a fresh numeric input for every autonomous climate controller", () => {
    const now = Date.parse("2026-08-09T21:30:00Z");
    expect(
      autonomousClimateInputIsUsable(
        { measurement: 28, sourceState: "heat", last_reported: "2026-08-09T21:15:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      autonomousClimateInputIsUsable(
        { measurement: 20, sourceState: "cool", last_reported: "2026-08-09T06:08:59Z" },
        now,
      ),
    ).toBe(false);
    expect(
      autonomousClimateInputIsUsable(
        { measurement: null, sourceState: "heat", last_reported: "2026-08-09T21:29:00Z" },
        now,
      ),
    ).toBe(false);
  });
});

describe("bedroomHeaterMode", () => {
  it("reads the retired manual mode as auto and anything else as off", () => {
    expect(bedroomHeaterMode({ mode: "auto" })).toBe("auto");
    expect(bedroomHeaterMode({ mode: "manual" })).toBe("auto");
    expect(bedroomHeaterMode({ mode: "off" })).toBe("off");
    expect(bedroomHeaterMode({})).toBe("off");
    expect(bedroomHeaterMode(undefined)).toBe("off");
  });
});

describe("bedroomHeaterSleepTimerExpired", () => {
  it("is false with no timer and true once the endpoint passes", () => {
    expect(bedroomHeaterSleepTimerExpired(PREFS, 1_000)).toBe(false);
    const endsAt = new Date(5_000).toISOString();
    expect(bedroomHeaterSleepTimerExpired({ ...PREFS, offTimerEndsAt: endsAt }, 4_999)).toBe(false);
    expect(bedroomHeaterSleepTimerExpired({ ...PREFS, offTimerEndsAt: endsAt }, 5_000)).toBe(true);
  });

  it("treats an unparseable endpoint as no timer rather than as expired", () => {
    expect(bedroomHeaterSleepTimerExpired({ ...PREFS, offTimerEndsAt: "later" }, 9e12)).toBe(false);
    expect(bedroomHeaterSleepTimerExpired({ ...PREFS, offTimerEndsAt: null }, 9e12)).toBe(false);
  });
});

describe("BedroomHeaterThermostat.resetForUserRequest", () => {
  /*
   * Regression for 2026-08-08: the heater emitted three turn_on commands in
   * 12 seconds while the user was trying to switch it off. evaluateBedroomHeaterNow
   * called reset(), which cleared lastTransitionAt — the only field enforcing the
   * minimum cycle — so every press re-armed the loop to switch a 2 kW relay with
   * no dwell at all.
   */
  it("keeps the minimum-cycle dwell across a user request", () => {
    const thermostat = new BedroomHeaterThermostat();
    const prefs = { ...PREFS, mode: "auto" as const, temperature: 26 };

    // Cold room: the thermostat switches on and records the transition.
    const first = thermostat.plan({
      currentTemperature: 20,
      entityId: "switch.bedroom",
      isOn: false,
      now: 0,
      preferences: prefs,
    });
    expect(first.actions.map((a) => a.service)).toEqual(["turn_on"]);

    // A user press moments later must not be able to re-cycle the relay.
    thermostat.resetForUserRequest();
    const second = thermostat.plan({
      currentTemperature: 20,
      entityId: "switch.bedroom",
      isOn: false,
      now: 5_000,
      preferences: prefs,
    });
    expect(second.actions).toEqual([]);
    expect(second.reason).toBe("min-cycle-hold-off");

    // Once the dwell has genuinely elapsed the request is honoured.
    const third = thermostat.plan({
      currentTemperature: 20,
      entityId: "switch.bedroom",
      isOn: false,
      now: BEDROOM_HEATER_MIN_CYCLE_MS + 1,
      preferences: prefs,
    });
    expect(third.actions.map((a) => a.service)).toEqual(["turn_on"]);
  });

  it("still clears the settle state so a fresh request is not swallowed", () => {
    const thermostat = new BedroomHeaterThermostat();
    thermostat.resetForUserRequest();
    // No prior transition: nothing to preserve, and the request runs immediately.
    const plan = thermostat.plan({
      currentTemperature: 10,
      entityId: "switch.bedroom",
      isOn: false,
      now: 1_000,
      preferences: { ...PREFS, mode: "auto" as const, temperature: 20 },
    });
    expect(plan.actions.map((a) => a.service)).toEqual(["turn_on"]);
  });

  it("restores dwell and sensor grace state after a process restart", () => {
    const thermostat = new BedroomHeaterThermostat();
    thermostat.reconcile({ lastTransitionAt: 50_000, sensorPendingSinceAt: 60_000 });
    expect(thermostat.snapshot()).toMatchObject({
      lastTransitionAt: 50_000,
      sensorPendingSinceAt: 60_000,
    });
  });
});
