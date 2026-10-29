import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  hvacCalls,
  loadController,
  lounge,
  pressManual,
  resetWorld,
  settle,
  setWorld,
  world,
} from "./climate-control-world.fixtures";

vi.mock("./preferences", async () => (await import("./climate-control-world.fixtures")).preferencesMock());
vi.mock("./ha/client", async () => (await import("./climate-control-world.fixtures")).haClientMock());
vi.mock("./dashboard-config", async () => (await import("./climate-control-world.fixtures")).dashboardConfigMock());
vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/*
 * Manual only ever does what the owner set, and nothing else — inviolable
 * (specs/aircon-auto-control.md §5.0).
 *
 * 2026-10-29: Manual showing Cool, the target moved 22 -> 23 over a 22 degree
 * room, and the loop quietly ran the unit in heat. Nothing had been seated, so the
 * room chose the direction on every tick, and the Cool on the card was only the
 * room's answer of the moment. Raising a Cool target is a floor the room may warm
 * up to on its own — a power-saving setting, never a request to heat.
 */

const moveTarget = (control: Awaited<ReturnType<typeof loadController>>, temperature: number) =>
  control.handleLegacyClimateAction({
    entityId: "climate.ac", domain: "climate", service: "set_temperature",
    data: { temperature }, remember: { aircon: { temperature } },
  });

/** Ticks past every dwell and settling hold, the room where it was. */
async function longAfter(control: Awaited<ReturnType<typeof loadController>>, roomTemperature: number, acState: string) {
  for (const minutes of [1, 15, 45, 90]) {
    vi.setSystemTime(new Date(Date.parse("2026-10-29T08:00:00Z") + minutes * 60_000));
    setWorld({ acState, roomTemperature, quiet: "off" });
    await settle(control);
  }
}

describe("Manual never changes its own direction", () => {
  test("a Cool target raised above the room never heats (the 2026-10-29 incident)", async () => {
    // Manual entered without a direction, as an app sending mode alone does; the
    // unit running cool is what she sees, so that is what gets seated.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 22 } });
    setWorld({ acState: "cool", roomTemperature: 22, quiet: "off" });
    const control = await loadController();
    await control.handleLegacyClimateAction({ entityId: "climate.ac", domain: "climate", service: "turn_on" });
    await settle(control);
    expect((await lounge(control)).direction).toBe("cool");

    world.calls.length = 0;
    await moveTarget(control, 23);
    await longAfter(control, 22, "fan_only");

    expect(hvacCalls("heat")).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.direction).toBe("cool");
  });

  test("a seated Cool holds through any target the owner moves", async () => {
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 22 } });
    setWorld({ acState: "off", roomTemperature: 22, quiet: "off" });
    const control = await loadController();
    await pressManual(control, "cool");
    await settle(control);

    world.calls.length = 0;
    for (const target of [23, 25, 28]) await moveTarget(control, target);
    await longAfter(control, 22, "fan_only");

    expect(hvacCalls("heat")).toHaveLength(0);
    expect((await lounge(control)).direction).toBe("cool");
  });

  test("a seated Heat holds through a target dropped below the room", async () => {
    resetWorld({ aircon: { autoMode: false, hvacMode: "heat", temperature: 22 } });
    setWorld({ acState: "off", roomTemperature: 22, quiet: "off" });
    const control = await loadController();
    await pressManual(control, "heat");
    await settle(control);

    world.calls.length = 0;
    await moveTarget(control, 18);
    await longAfter(control, 22, "fan_only");

    expect(hvacCalls("cool")).toHaveLength(0);
    expect((await lounge(control)).direction).toBe("heat");
  });

  test("a parked unit on its target seats the remembered direction, then holds it", async () => {
    // Fan only is the thermostat's park and the room sits exactly on the target,
    // so neither says which way; the last direction is the seat.
    resetWorld({ aircon: { autoMode: false, hvacMode: "cool", temperature: 22 } });
    setWorld({ acState: "fan_only", roomTemperature: 22, quiet: "off" });
    const control = await loadController();
    await control.handleLegacyClimateAction({ entityId: "climate.ac", domain: "climate", service: "turn_on" });
    await settle(control);

    world.calls.length = 0;
    await moveTarget(control, 23);
    await longAfter(control, 22, "fan_only");

    expect(hvacCalls("heat")).toHaveLength(0);
    expect((await lounge(control)).direction).toBe("cool");
  });
});
