import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  hvacCalls,
  loadController,
  lounge,
  offCalls,
  pressManual,
  resetWorld,
  settle,
  setWorld,
  world,
} from "./climate-control-world.fixtures";

/*
 * No blind running (specs/aircon-auto-control.md §5.2).
 *
 * Adeline, 2026-09-19: "we don't run heating or cooling blind. but we do leave
 * the goddamn mode selected in case a temp value comes back." With no usable
 * reading the unit stops at once and the selected mode waits — it does not retry
 * on a guess, and nothing switches the mode off.
 */

vi.mock("./preferences", async () => (await import("./climate-control-world.fixtures")).preferencesMock());
vi.mock("./ha/client", async () => (await import("./climate-control-world.fixtures")).haClientMock());
vi.mock("./dashboard-config", async () => (await import("./climate-control-world.fixtures")).dashboardConfigMock());
vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

/** Older than AUTONOMOUS_CLIMATE_INPUT_MAX_AGE_MS: the reading is gone. */
const STALE = 45;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T08:00:00Z"));
  resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 21 } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a lost temperature reading", () => {
  test("stops the unit but keeps Manual selected", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "heat", roomTemperature: 18 });
    await settle(control);
    expect(offCalls()).toHaveLength(0);

    world.calls.length = 0;
    setWorld({ acState: "heat", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("grace");
    expect(room.sensorAvailable).toBe(false);
    expect(room.lastStopReason).toBe("sensor-unavailable");
  });

  test("never starts the unit again while it is missing", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "off", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);
    world.calls.length = 0;

    // An hour and a half later, still nothing from the sensor.
    vi.setSystemTime(new Date("2026-09-19T09:30:00Z"));
    setWorld({ acState: "off", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);

    expect(world.calls).toHaveLength(0);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("puts Manual straight back to work when a reading returns", async () => {
    const control = await loadController();
    await pressManual(control);
    setWorld({ acState: "off", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);
    world.calls.length = 0;

    vi.setSystemTime(new Date("2026-09-19T08:30:00Z"));
    setWorld({ acState: "off", roomTemperature: 18 });
    await settle(control);

    expect(hvacCalls("heat").length).toBeGreaterThanOrEqual(1);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("leaves Auto armed too, in preferences as well as in the public state", async () => {
    resetWorld({ aircon: { autoMode: true, hvacMode: "heat", temperature: 21 } });
    const control = await loadController();
    setWorld({ acState: "heat", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);

    expect(offCalls().length).toBeGreaterThanOrEqual(1);
    const room = await lounge(control);
    expect(room.mode).toBe("auto");
    expect(room.phase).toBe("grace");
    expect((world.preferences.aircon as Record<string, unknown>).autoMode).toBe(true);
  });

  test("and Auto picks the room up again when the reading comes back", async () => {
    resetWorld({ aircon: { autoMode: true, hvacMode: "heat", temperature: 21 } });
    const control = await loadController();
    setWorld({ acState: "heat", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);
    // The unit acknowledges the stop (inside the command-settle window, or the
    // change would read as someone working the unit by hand).
    setWorld({ acState: "off", roomTemperature: 18, sensorAgeMinutes: STALE });
    await settle(control);
    world.calls.length = 0;

    // Past the compressor dwell, with the room still under target.
    vi.setSystemTime(new Date("2026-09-19T08:15:00Z"));
    setWorld({ acState: "off", roomTemperature: 18 });
    await settle(control);

    expect(hvacCalls("heat").length).toBeGreaterThanOrEqual(1);
    expect((await lounge(control)).mode).toBe("auto");
  });
});
