import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/*
 * Manual through the server loop (specs/aircon-auto-control.md §5).
 *
 * Adeline, 2026-09-19: "the auto/manual/mode toggle is a switch that the user
 * sets, nobody else. if it's set to manual then it has to stay on and continue
 * running the manual rules." Manual switches the unit off at target, so these
 * tests are mostly about what the room reports once it has done that.
 */

type Json = Record<string, unknown>;
const calls: Array<{ domain: string; service: string; data: Json }> = [];
let prefs: Json = {};
let states: Json[] = [];
let statePath = "";

function merge(target: Json, patch: Json): Json {
  const out: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge((out[key] as Json) ?? {}, value as Json)
      : value;
  }
  return out;
}

vi.mock("./preferences", () => ({
  mergeDashboardPreferences: async (patch: Json) => {
    prefs = merge(prefs, patch);
  },
  readDashboardPreferences: async () => prefs,
}));

vi.mock("./ha/client", () => ({
  callService: async (domain: string, service: string, data: Json) => {
    calls.push({ domain, service, data });
    return [];
  },
  haRest: async () => states,
}));

vi.mock("./dashboard-config", () => {
  const config = {
    dashboard: {
      aircon: { title: "Lounge", matchTokens: [] },
      bedroomHeater: { title: "Bedroom", switchEntityIds: [], temperatureEntityIds: [], humidityEntityIds: [] },
      climate: {
        airconUnits: [{
          id: "lounge",
          title: "Lounge",
          entityId: "climate.ac",
          matchTokens: [],
          temperatureEntityIds: ["sensor.lounge_temperature"],
          humidityEntityIds: [],
        }],
        heaters: [],
      },
    },
  };
  return { readDashboardConfig: async () => config, readDashboardConfigSync: () => config };
});

vi.mock("./ha", () => ({ buildDashboardState: async () => ({ entities: [] }) }));

/** The Gree reports its own return-air temperature; that is the control sensor. */
function world({ acState = "off", roomTemperature = 22 } = {}) {
  const at = new Date().toISOString();
  states = [
    {
      entity_id: "climate.ac",
      state: acState,
      attributes: {
        friendly_name: "Air Conditioner",
        hvac_modes: ["off", "heat", "cool", "fan_only"],
        fan_modes: ["low", "medium", "high"],
        min_temp: 16,
        temperature: 21,
        current_temperature: roomTemperature,
      },
      last_changed: at, last_updated: at, last_reported: at,
    },
    {
      entity_id: "sensor.lounge_temperature",
      state: String(roomTemperature),
      attributes: {},
      last_changed: at, last_updated: at, last_reported: at,
    },
  ];
}

async function load({ freshStatePath = true } = {}) {
  vi.resetModules();
  // The loop keeps its runtime on globalThis so it survives hot reloads; a
  // reload against the same state file is how the durable mode is tested.
  delete (globalThis as { __novaClimateControlRuntime?: unknown }).__novaClimateControlRuntime;
  if (freshStatePath) {
    statePath = path.join(mkdtempSync(path.join(tmpdir(), "nova-manual-")), "state.json");
  }
  process.env.NOVA_CLIMATE_CONTROL_STATE = statePath;
  const module = await import("./climate-control");
  module.stopClimateControlForTest();
  return module;
}

type Control = Awaited<ReturnType<typeof load>>;

/** A request fires a tick of its own; let it finish before driving another. */
async function settle(control: Control) {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await control.evaluateClimateControlNow();
  }
}

/** What the card reads: the selected mode and whether the unit is running. */
async function lounge(control: Control) {
  return (await control.climateControlState()).lounge;
}

const hvac = (mode: string) => calls.filter((call) => call.service === "set_hvac_mode" && call.data.hvac_mode === mode);
const offs = () => calls.filter((call) => call.service === "turn_off");

/** Pressing Manual on the card: a direction plus the remembered settings. */
async function pressManual(control: Control, direction: "heat" | "cool" = "heat") {
  await control.handleLegacyClimateAction({
    entityId: "climate.ac",
    domain: "climate",
    service: "set_hvac_mode",
    data: { hvac_mode: direction },
    remember: { aircon: { autoMode: false, hvacMode: direction } },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-19T08:00:00Z"));
  calls.length = 0;
  prefs = { aircon: { autoMode: false, hvacMode: "heat", temperature: 21 } };
  world();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Manual mode", () => {
  test("reaching the target stops the unit and stays in Manual", async () => {
    const control = await load();
    await pressManual(control);
    // Heating a room already a degree over target.
    world({ acState: "heat", roomTemperature: 22 });
    await settle(control);

    // Home Assistant is mocked and keeps reporting "heat", so the guard-free
    // stop repeats; what matters is that it stopped and stayed in Manual.
    expect(offs().length).toBeGreaterThanOrEqual(1);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("resting");
    expect(room.direction).toBe("heat");
  });

  test("a room already at target rests without deselecting Manual", async () => {
    const control = await load();
    await pressManual(control);
    world({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    // The unit has now actually switched off, which is what used to read as Off.
    world({ acState: "off", roomTemperature: 22 });
    calls.length = 0;
    await settle(control);

    expect(calls).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("manual");
    expect(room.phase).toBe("resting");
  });

  test("Manual starts the unit again once the room drifts", async () => {
    const control = await load();
    await pressManual(control);
    world({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    world({ acState: "off", roomTemperature: 22 });
    await settle(control);
    calls.length = 0;

    // Past the 10-minute compressor dwell, three degrees under target.
    vi.setSystemTime(new Date("2026-09-19T08:45:00Z"));
    world({ acState: "off", roomTemperature: 18 });
    await settle(control);
    await settle(control);

    expect(hvac("heat")).toHaveLength(1);
    expect((await lounge(control)).mode).toBe("manual");
  });

  test("Manual survives a controller restart with the unit resting", async () => {
    let control = await load();
    await pressManual(control);
    world({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    world({ acState: "off", roomTemperature: 22 });
    await settle(control);

    control = await load({ freshStatePath: false });
    await settle(control);

    expect((await lounge(control)).mode).toBe("manual");
  });

  test("Off is Off: the loop does not start the unit again", async () => {
    const control = await load();
    await pressManual(control);
    world({ acState: "heat", roomTemperature: 22 });
    await settle(control);
    await control.handleLegacyClimateAction({
      entityId: "climate.ac",
      domain: "climate",
      service: "turn_off",
      remember: { aircon: { autoMode: false, offTimerEndsAt: null } },
    });
    calls.length = 0;
    vi.setSystemTime(new Date("2026-09-19T09:00:00Z"));
    world({ acState: "off", roomTemperature: 18 });
    await settle(control);

    expect(hvac("heat")).toHaveLength(0);
    const room = await lounge(control);
    expect(room.mode).toBe("off");
    expect(room.phase).toBe("off");
  });

  test("an expired sleep timer does end the mode", async () => {
    const control = await load();
    await pressManual(control);
    prefs = merge(prefs, { aircon: { offTimerEndsAt: "2026-09-19T07:59:00Z" } });
    world({ acState: "heat", roomTemperature: 18 });
    await settle(control);

    expect(offs().length).toBeGreaterThanOrEqual(1);
    expect((await lounge(control)).mode).toBe("off");
  });

  test("Auto still rests as Auto", async () => {
    prefs = { aircon: { autoMode: true, hvacMode: "heat", temperature: 21 } };
    const control = await load();
    world({ acState: "off", roomTemperature: 22 });
    await settle(control);

    const room = await lounge(control);
    expect(room.mode).toBe("auto");
    expect(room.phase).toBe("resting");
  });
});
