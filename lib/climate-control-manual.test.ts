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
    // repeats; what matters is that it stopped and stayed in Manual.
    expect(offCalls().length).toBeGreaterThanOrEqual(1);
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
    // The unit has now actually switched off, which is what used to read as Off.
    setWorld({ acState: "off", roomTemperature: 22 });
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
