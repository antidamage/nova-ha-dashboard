import { describe, expect, it } from "vitest";
import {
  BEDROOM_HEATER_MIN_CYCLE_MS,
  BEDROOM_HEATER_TAIL_OFF_MS,
  BedroomHeaterThermostat,
  bedroomHeaterMode,
  bedroomRoomTemperatureEntityIds,
  bedroomTemperatureStateIsFresh,
  bedroomHeaterSleepTimerExpired,
  createInitialBedroomHeaterAutoState,
  formatMinutesFromMidday,
  bedroomHeaterScheduleEdge,
  minutesFromMidday,
  planBedroomHeaterTick,
  type BedroomHeaterAutoState,
} from "./bedroom-heater-control";

describe("bedroom room temperature authority", () => {
  it("permits only the Bedroom sensor and never falls back to the heater plug", () => {
    expect(
      bedroomRoomTemperatureEntityIds([
        "sensor.tuya_mobile_bedroom_sensor_temperature",
        "sensor.tuya_mobile_bedroom_heater_temperature",
      ]),
    ).toEqual(["sensor.tuya_mobile_bedroom_sensor_temperature"]);
    expect(bedroomRoomTemperatureEntityIds(["sensor.tuya_mobile_bedroom_heater_temperature"])).toEqual([]);
  });

  it("rejects a stale or undated reading", () => {
    const now = Date.parse("2026-08-09T21:30:00Z");
    expect(bedroomTemperatureStateIsFresh({ last_reported: "2026-08-09T21:15:00Z" }, now)).toBe(true);
    expect(bedroomTemperatureStateIsFresh({ last_reported: "2026-08-09T06:08:59Z" }, now)).toBe(false);
    expect(bedroomTemperatureStateIsFresh({}, now)).toBe(false);
  });
});

const ENTITY = "switch.tuya_mobile_bedroom_heater";
// 18:00 -> 07:00 next day, the shipped default window.
const PREFS = { mode: "auto" as const, temperature: 20, autoOnMinutes: 360, autoOffMinutes: 1140 };
// The planner is clock-free now: the window only moves the mode, and the
// planner is only ever asked to run once the mode is already "auto".

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

describe("minutesFromMidday", () => {
  it("puts midday at zero and midnight at 720", () => {
    expect(minutesFromMidday(new Date("2026-08-07T12:00:00"))).toBe(0);
    expect(minutesFromMidday(new Date("2026-08-07T00:00:00"))).toBe(720);
    expect(minutesFromMidday(new Date("2026-08-07T18:00:00"))).toBe(360);
    expect(minutesFromMidday(new Date("2026-08-07T07:00:00"))).toBe(1140);
  });
});

describe("bedroomHeaterScheduleEdge", () => {
  // 18:00 -> 07:00 on the midday axis is 360 -> 1140.
  it("reports nothing on an ordinary tick between endpoints", () => {
    expect(bedroomHeaterScheduleEdge(400, 400.5, 360, 1140)).toBe(null);
    expect(bedroomHeaterScheduleEdge(400, 401, 360, 1140)).toBe(null);
    expect(bedroomHeaterScheduleEdge(1200, 1201, 360, 1140)).toBe(null);
  });

  it("fires auto on the start edge and off on the end edge", () => {
    expect(bedroomHeaterScheduleEdge(359, 360, 360, 1140)).toBe("auto");
    expect(bedroomHeaterScheduleEdge(1139, 1140, 360, 1140)).toBe("off");
  });

  it("does not re-fire an edge it has already applied", () => {
    expect(bedroomHeaterScheduleEdge(360, 361, 360, 1140)).toBe(null);
  });

  it("still lands on the right mode after a stall that skipped both edges", () => {
    // Asleep from 17:00 through to 08:00: crossed on, then off. Off is later.
    expect(bedroomHeaterScheduleEdge(300, 1200, 360, 1140)).toBe("off");
    // Asleep from 06:00 through to 19:00: crossed off, then on.
    expect(bedroomHeaterScheduleEdge(1080, 420, 360, 1140)).toBe("auto");
  });

  it("handles a window that wraps past midday", () => {
    // 09:00 -> 14:00 is 1260 -> 120.
    expect(bedroomHeaterScheduleEdge(1259, 1260, 1260, 120)).toBe("auto");
    expect(bedroomHeaterScheduleEdge(119, 120, 1260, 120)).toBe("off");
  });

  it("reports nothing for a zero-width window or a still clock", () => {
    expect(bedroomHeaterScheduleEdge(400, 500, 500, 500)).toBe(null);
    expect(bedroomHeaterScheduleEdge(500, 500, 360, 1140)).toBe(null);
  });
});

describe("formatMinutesFromMidday", () => {
  it("renders the midday axis as wall-clock time, marking the next day", () => {
    expect(formatMinutesFromMidday(0)).toBe("12:00 pm");
    expect(formatMinutesFromMidday(360)).toBe("6:00 pm");
    expect(formatMinutesFromMidday(720)).toBe("12:00 am +1");
    expect(formatMinutesFromMidday(1140)).toBe("7:00 am +1");
    expect(formatMinutesFromMidday(1440)).toBe("12:00 pm +1");
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

  it("runs on past target for the tail-off period rather than cutting immediately", () => {
    const entered = 1_000_000;
    const state: BedroomHeaterAutoState = {
      ...createInitialBedroomHeaterAutoState(),
      enteredBandAt: entered,
      lastTargetTemperature: 20,
    };
    const during = plan({ currentTemperature: 20, isOn: true, state, now: entered + 30_000 });
    expect(during.actions).toEqual([]);
    expect(during.reason).toBe("tail-off");

    const after = plan({
      currentTemperature: 20,
      isOn: true,
      state,
      now: entered + BEDROOM_HEATER_TAIL_OFF_MS + 1,
    });
    expect(after.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(after.reason).toBe("reached-target");
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

    // Reaches target, runs the tail, then cuts.
    expect(tick(20).reason).toBe("tail-off");
    now += BEDROOM_HEATER_TAIL_OFF_MS + 1;
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

  it("heats regardless of the clock, because the window is a schedule not a gate", () => {
    // 09:00, hours outside the default 18:00 -> 07:00 window. Auto is Auto.
    const result = plan({ currentTemperature: 15, now: new Date("2026-08-07T09:00:00").getTime() });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_on" }]);
  });

  it("forces an active heater off without a temperature reading", () => {
    const result = plan({ currentTemperature: null, isOn: true });
    expect(result.actions).toEqual([{ entityId: ENTITY, domain: "switch", service: "turn_off" }]);
    expect(result.reason).toBe("sensor-fail-safe-off");
  });

  it("stays off without a temperature reading", () => {
    const result = plan({ currentTemperature: null, isOn: false });
    expect(result.actions).toEqual([]);
    expect(result.reason).toBe("sensor-fail-safe-off");
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
});
