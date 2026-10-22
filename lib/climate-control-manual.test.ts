import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  hvacCalls,
  loadController,
  lounge,
  merge,
  offCalls,
  pressManual,
  resetWorld,
  settle,
  setWorld,
  world,
} from "./climate-control-world.fixtures";

/*
 * Manual through the server loop (specs/aircon-auto-control.md §5.1).
 *
 * Adeline, 2026-09-19: "the auto/manual/mode toggle is a switch that the user
 * sets, nobody else. if it's set to manual then it has to stay on and continue
 * running the manual rules." Manual switches the unit off at target, so these
 * tests are mostly about what the room reports once it has done that. The sensor
 * rules are in climate-control-blind-sensor.test.ts.
 */

vi.mock("./preferences", async () => (await import("./climate-control-world.fixtures")).preferencesMock());
vi.mock("./ha/client", async () => (await import("./climate-control-world.fixtures")).haClientMock());
vi.mock("./dashboard-config", async () => (await import("./climate-control-world.fixtures")).dashboardConfigMock());
vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T08:00:00Z"));
  resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21 } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Manual mode", () => {
  test("reaching the target stops the unit and stays in Manual", async () => {
    const control = await loadController();
    await pressManual(control);
    // Heating a room already a degree over target.
    setWorld({ acState: "heat", roomTemperature: 22 });
    await settle(control);

    // Home Assistant is mocked and keeps reporting "heat", so the guard-free stop
    // repeats; what matters is that it parked on fan only (not off, so the sensor
    // stays awake) and stayed in Manual.
    expect(hvacCalls("fan_only").length).toBeGreaterThanOrEqual(1);
    expect(offCalls()).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("resting");
    expect(room.direction).toBe("heat");
  });

  test("a room already at target rests without deselecting Manual", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    // The unit has now actually parked on fan only, which is what used to read as Off.
    setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 22 });
    world.calls.length = 0;
    await settle(control);

    expect(world.calls).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("resting");
  });

  test("Manual starts the unit again once the room drifts", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    setWorld({ acState: "off", roomTemperature: 22 });
    await settle(control);
    world.calls.length = 0;

    // Past the 10-minute compressor dwell, four degrees under target.
    vi.setSystemTime(new Date("2026-09-19T08:45:00Z"));
    setWorld({ acState: "off", roomTemperature: 18 });
    await settle(control);
    await settle(control);

    expect(hvacCalls("heat")).toHaveLength(1);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("Manual survives a controller restart with the unit resting", async () => {
    let control = await loadController();
    await pressManual(control);
    setWorld({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    setWorld({ acState: "off", roomTemperature: 22 });
    await settle(control);

    control = await loadController({ freshStatePath: false });
    await settle(control);

    expect((await lounge(control)).mode).toBe("manual");
  });

  test("Off is Off: the loop does not start the unit again", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    await control.handleLegacyClimateAction({
      entityId: "climate.ac",
      domain: "climate",
      service: "turn_off",
      remember: { aircon: { autoMode: false, offTimerEndsAt: null } },
    });
    world.calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00Z"));
    setWorld({ acState: "off", roomTemperature: 18 });
    await settle(control);

    expect(hvacCalls("heat")).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("off");
    expect(room.phase).toBe("off");
  });

  test("an expired sleep timer does end the mode", async () => {
    const control = await loadController();
    await pressManual(control);
    world.preferences = merge(world.preferences, { aircon: { offTimerEndsAt: "2026-09-19T07:59:00Z" } });
    setWorld({ acState: "heat", roomTemperature: 18 });
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    expect((await lounge(control)).mode).toBe("off");
  });

  test("a room at target is parked on fan only, not switched off, and Manual stays selected", async () => {
    resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 22 } });
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "off", roomTemperature: 22 });
    await settle(control);

    expect(hvacCalls("fan_only").length).toBeGreaterThanOrEqual(1);
    expect(world.calls.some((call) => call.service === "set_fan_mode" && call.data.fan_mode === "low")).toBe(true);
    expect(offCalls()).toHaveLength(0);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("a parked unit reads as resting, not driving", async () => {
    const control = await loadController();
    await pressManual(control);
    await settle(control);
    setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 21 });
    await settle(control);
    world.calls.length = 0;
    await settle(control);

    expect(world.calls).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("resting");
  });

  test("a parked unit with no seated direction is driven by the room, not mistaken for Fan", async () => {
    const control = await loadController();
    setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 18 });
    await settle(control);

    expect(hvacCalls("heat").length).toBeGreaterThanOrEqual(1);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("starting from parked puts the owner's fan speed back", async () => {
    resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21, fanMode: "high" } });
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 18 });
    await settle(control);

    expect(hvacCalls("heat").length).toBeGreaterThanOrEqual(1);
    expect(world.calls.some((call) => call.service === "set_fan_mode" && call.data.fan_mode === "high")).toBe(true);
  });

  describe("Aggressive", () => {
    /** Stopped at 08:00, then the room drifts at 08:05: past Aggressive's 3-minute dwell, inside the normal 10. */
    async function driftAfterStop(preferences: Record<string, unknown>) {
      resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21, ...preferences } });
      const control = await loadController();
      await pressManual(control);
      setWorld({ acState: "heat", roomTemperature: 22, turbo: "on" });
      await settle(control);
      // The unit parks, which is what the loop then observes.
      setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 22, turbo: "on" });
      await settle(control);
      world.calls.length = 0;

      vi.setSystemTime(new Date("2026-09-19T08:05:00Z"));
      setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 20, turbo: "on" });
      await settle(control);
      await settle(control);
      return control;
    }

    test("restarts after three minutes where normal Manual waits ten", async () => {
      const control = await driftAfterStop({ turboMode: true, aggressiveMode: true });

      expect(hvacCalls("heat")).toHaveLength(1);
      expect((await lounge(control)).mode).toBe("manual");
    });

    test("Turbo alone still waits out the ten-minute dwell", async () => {
      await driftAfterStop({ turboMode: true });

      expect(hvacCalls("heat")).toHaveLength(0);
    });

    test("does not apply once the unit's Turbo is off", async () => {
      resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21, turboMode: true, aggressiveMode: true } });
      const control = await loadController();
      await pressManual(control);
      setWorld({ acState: "heat", roomTemperature: 22, turbo: "off" });
      await settle(control);
      setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 22, turbo: "off" });
      await settle(control);
      world.calls.length = 0;

      vi.setSystemTime(new Date("2026-09-19T08:05:00Z"));
      setWorld({ acState: "fan_only", fanMode: "low", roomTemperature: 20, turbo: "off" });
      await settle(control);
      await settle(control);

      expect(hvacCalls("heat")).toHaveLength(0);
    });
  });

  test("Auto still rests as Auto", async () => {
    resetWorld({ aircon: { autoMode: true, hvacMode: "heat", temperature: 21 } });
    const control = await loadController();
    setWorld({ acState: "off", roomTemperature: 22 });
    await settle(control);

    const room = await lounge(control);
    expect(room.mode).toBe("auto");
    expect(room.phase).toBe("resting");
  });
});
