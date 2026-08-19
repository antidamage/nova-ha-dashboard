import { describe, expect, it } from "vitest";
import { autonomousClimateInputIsUsable } from "./autonomous-climate-safety";
import {
  BEDROOM_HEATER_MIN_CYCLE_MS,
  BEDROOM_HEATER_SENSOR_GRACE_MS,
  BedroomHeaterThermostat,
  bedroomHeaterMode,
  roomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
  bedroomTemperatureStateIsUsable,
  bedroomHeaterSleepTimerExpired,
  createInitialBedroomHeaterAutoState,
  planBedroomHeaterTick,
  type BedroomHeaterAutoState,
} from "./bedroom-heater-control";

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

const ENTITY = "switch.tuya_mobile_bedroom_heater";
const PREFS = { mode: "auto" as const, temperature: 20 };
// The planner is clock-free: nothing but a user action puts the heater in
// "auto", and the planner is only ever asked to run once it is.

function plan(over: Partial<Parameters<typeof planBedroomHeaterTick>[0]> = {}) {
  return planBedroomHeaterTick({
    currentTemperature: 20,
    entityId: ENTITY,
    isOn: false,
    now: 1_000_000,
    preferences: PREFS,
    state: createInitialBedroomHeaterAutoState(),
    ...over,
  });
}

describe("no clock schedule", () => {
  /**
   * The auto-on/auto-off window was removed on 2026-08-19: the heater must
   * never start or stop itself because a time of day arrived. This test exists
   * so reinstating a schedule is a deliberate act, not an accident.
   */
  it("exports nothing that turns the heater on or off by the clock", async () => {
    const control = await import("./bedroom-heater-control");
    for (const name of [
      "bedroomHeaterScheduleEdge",
      "bedroomHeaterWindow",
      "minutesFromMidday",
      "formatMinutesFromMidday",
      "clampWindowMinutes",
    ]) {
      expect(control).not.toHaveProperty(name);
    }
  });

  it("plans identically whatever the wall clock says", () => {
    const cold = { currentTemperature: 15 };
    const midnight = plan({ ...cold, now: new Date("2026-08-19T00:00:00").getTime() });
    const midday = plan({ ...cold, now: new Date("2026-08-19T12:00:00").getTime() });
    expect(midnight.actions).toEqual(midday.actions);
    expect(midnight.reason).toBe(midday.reason);
  });
});

describe("planBedroomHeaterTick", () => {
  it("heats when the room is below the band", () => {
    const result = plan({ currentTemperature: 18 });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
    expect(result.reason).toBe("heating");
  });

  it("sends nothing when it is already heating", () => {
    const result = plan({ currentTemperature: 18, isOn: true });
    expect(result.actions).toEqual([]);
    expect(result.reason).toBe("heating");
  });

  it("cuts immediately at target because the remote room puck needs no tail", () => {
    const entered = 1_000_000;
    const state: BedroomHeaterAutoState = {
      ...createInitialBedroomHeaterAutoState(),
      enteredBandAt: entered,
      lastTargetTemperature: 20,
    };
    const during = plan({ currentTemperature: 20, isOn: true, state, now: entered + 30_000 });
    expect(during.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(during.reason).toBe("reached-target");
  });

  it("stops immediately when the room is above the band, with no tail", () => {
    const result = plan({ currentTemperature: 24, isOn: true });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(result.reason).toBe("above-target");
  });

  it("suppresses a transition inside the minimum cycle time", () => {
    const state: BedroomHeaterAutoState = {
      ...createInitialBedroomHeaterAutoState(),
      lastTransitionAt: 1_000_000,
      lastTargetTemperature: 20,
    };
    const held = plan({ currentTemperature: 18, state, now: 1_000_000 + 60_000 });
    expect(held.actions).toEqual([]);
    expect(held.reason).toBe("min-cycle-hold-off");

    const released = plan({
      currentTemperature: 18,
      state,
      now: 1_000_000 + BEDROOM_HEATER_MIN_CYCLE_MS + 1,
    });
    expect(released.actions).toHaveLength(1);
  });

  it("reopens a settled cycle when the user raises the target", () => {
    const state: BedroomHeaterAutoState = {
      ...createInitialBedroomHeaterAutoState(),
      enteredBandAt: 1,
      tailedOff: true,
      lastTargetTemperature: 18,
    };
    const result = plan({
      currentTemperature: 18,
      preferences: { ...PREFS, temperature: 22 },
      state,
    });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
  });

  // The whole point of Auto, walked end to end: heat below target, stop at
  // target, stay off through the homeostasis band, and fire again only once the
  // room has fallen back out the bottom of it.
  it("holds the room with hysteresis across a full cycle", () => {
    const target = 20;
    const prefs = { ...PREFS, temperature: target };
    let now = 1_000_000;
    let state = createInitialBedroomHeaterAutoState();
    let isOn = false;

    const tick = (currentTemperature: number) => {
      const result = plan({ currentTemperature, isOn, now, preferences: prefs, state });
      state = result.nextState;
      for (const action of result.actions) {
        isOn = action.service === "turn_on";
      }
      return result;
    };

    // Cold room: fire.
    expect(tick(17).actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
    expect(isOn).toBe(true);

    // Climbing but still below the band: keep heating.
    now += BEDROOM_HEATER_MIN_CYCLE_MS;
    expect(tick(19.2).actions).toEqual([]);
    expect(isOn).toBe(true);

    // Reaches target and cuts immediately.
    expect(tick(20).actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(isOn).toBe(false);

    // Drifting down inside the band is not a reason to fire.
    now += BEDROOM_HEATER_MIN_CYCLE_MS;
    expect(tick(19.6).actions).toEqual([]);
    expect(tick(19.5).actions).toEqual([]);
    expect(isOn).toBe(false);

    // Out the bottom of the band: fire again.
    now += BEDROOM_HEATER_MIN_CYCLE_MS;
    expect(tick(19.4).actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
    expect(isOn).toBe(true);
  });

  it("does not fire while the room sits above target", () => {
    expect(plan({ currentTemperature: 21, isOn: false }).actions).toEqual([]);
    expect(plan({ currentTemperature: 25, isOn: false }).actions).toEqual([]);
  });

  it("heats regardless of the clock", () => {
    // Nine in the morning. There is no window to be outside of: Auto is Auto.
    const result = plan({ currentTemperature: 15, now: new Date("2026-08-07T09:00:00").getTime() });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
  });

  it("tries heating first without a temperature reading, inside a 2-minute grace window", () => {
    const result = plan({ currentTemperature: null, isOn: false });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
    expect(result.reason).toBe("sensor-pending");
    expect(result.nextState.sensorPendingSinceAt).toBe(1_000_000);
  });

  it("leaves an already-on heater running without a reading, inside the grace window", () => {
    const result = plan({
      currentTemperature: null,
      isOn: true,
      state: { ...createInitialBedroomHeaterAutoState(), sensorPendingSinceAt: 1_000_000 },
      now: 1_000_000 + 60_000,
    });
    expect(result.actions).toEqual([]);
    expect(result.reason).toBe("sensor-pending");
  });

  it("switches off, but stays in Auto, once the grace window expires with still no reading", () => {
    const result = plan({
      currentTemperature: null,
      isOn: true,
      state: { ...createInitialBedroomHeaterAutoState(), sensorPendingSinceAt: 1_000_000 },
      now: 1_000_000 + BEDROOM_HEATER_SENSOR_GRACE_MS,
    });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(result.reason).toBe("sensor-fail-safe-off");
    expect(result.nextState.sensorPendingSinceAt).toBe(null);
  });

  it("retries heating on its own once the grace window and dwell both clear", () => {
    const timedOut = plan({
      currentTemperature: null,
      isOn: true,
      state: { ...createInitialBedroomHeaterAutoState(), sensorPendingSinceAt: 1_000_000 },
      now: 1_000_000 + BEDROOM_HEATER_SENSOR_GRACE_MS,
    });
    const retry = plan({
      currentTemperature: null,
      isOn: false,
      state: timedOut.nextState,
      now: 1_000_000 + BEDROOM_HEATER_SENSOR_GRACE_MS + BEDROOM_HEATER_MIN_CYCLE_MS + 1,
    });
    expect(retry.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
    expect(retry.reason).toBe("sensor-pending");
  });

  it("a valid reading clears the sensor-pending clock", () => {
    const result = plan({
      currentTemperature: 20,
      isOn: false,
      state: { ...createInitialBedroomHeaterAutoState(), sensorPendingSinceAt: 1_000_000 },
      now: 1_000_000 + 60_000,
    });
    expect(result.nextState.sensorPendingSinceAt).toBe(null);
  });

  it("does nothing without an entity", () => {
    const result = plan({ entityId: undefined, currentTemperature: 10 });
    expect(result.actions).toEqual([]);
    expect(result.reason).toBe("no-entity");
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
